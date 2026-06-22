#pragma once

#include <algorithm>
#include <filesystem>
#include <optional>
#include <sstream>
#include <string>

#include "asr/asr_backend.h"
#include "asr/whisper_output.h"
#include "common.h"
#include "protocol/json.h"
#include "runtime/health.h"
#include "runtime/request.h"
#include "runtime/tooling.h"
#include "subtitle/document.h"

namespace translate_ter::backend {

class WhisperCppCliBackend final : public AsrBackend {
 public:
  bool supports(const RuntimePayload& runtime, const std::string& request) const override {
    const auto asr_provider = extract_string(request, "asrProviderId").value_or("local.whisper.cpp");
    return starts_with(asr_provider, "local.whisper") && runtime.provider == "whisper.cpp";
  }

  bool can_reject_unmatched_request(const RuntimePayload& runtime, const std::string& request) const override {
    (void)runtime;
    (void)request;
    return true;
  }

  NativeResult transcribe(const std::string& request) const override {
    const auto asr_provider = extract_string(request, "asrProviderId").value_or("local.whisper.cpp");
    const auto media_path = extract_string(request, "audioPath").value_or(
        extract_string(request, "mediaPath").value_or(""));
    const auto source_language = extract_string(request, "sourceLanguage").value_or("auto");
    const auto target_language = extract_string(request, "targetLanguage").value_or("");
    const auto job_id = extract_string(request, "jobId").value_or("native-job");
    const bool prefer_cuda = extract_bool(request, "preferCuda").value_or(false);
    const int cpu_thread_count = std::max(1, extract_int(request, "cpuThreadCount").value_or(default_whisper_thread_count()));
    const auto runtime = parse_runtime_payload(request);

    if (!starts_with(asr_provider, "local.whisper")) {
      return {false, "", "UnsupportedCommand", "This local helper currently supports only the local Whisper method.", false};
    }
    if (runtime.provider != "whisper.cpp") {
      return {
          false,
          "",
          "UnsupportedCommand",
          "This local helper currently supports only runtime.provider=whisper.cpp.",
          false};
    }
    if (runtime.variant && !is_supported_runtime_variant(*runtime.variant)) {
      return {
          false,
          "",
          "MalformedRequest",
          "runtime.variant must be one of cpu, cuda, metal, or vulkan.",
          false};
    }

    const auto binary_path = runtime.binary_path;
    const auto model_path = runtime.model_path;
    if (!binary_path || !model_path || binary_path->empty() || model_path->empty()) {
      return {
          false,
          "",
          "MissingRuntime",
          "The local Whisper program or model is missing.",
          false};
    }
    if (!path_exists(*binary_path) || !path_exists(*model_path)) {
      return {
          false,
          "",
          "DownloadRequired",
          "The local Whisper program or model is not ready yet.",
          false};
    }
    if (media_path.empty() || !path_exists(media_path)) {
      return {false, "", "MalformedRequest", "The audio file to recognize could not be found.", false};
    }

    std::vector<std::filesystem::path> runtime_search_roots;
    runtime_search_roots.push_back(std::filesystem::path(*binary_path).parent_path());
    for (const auto& library_path : runtime.library_paths) {
      if (!library_path.empty()) {
        runtime_search_roots.emplace_back(library_path);
      }
    }
    const bool cuda_supported = detect_cuda_support(runtime_search_roots);
    const bool runtime_requests_gpu = runtime_variant_requests_gpu(runtime.variant);
    const bool use_gpu = runtime.variant.has_value() ? runtime_requests_gpu : prefer_cuda;
    const bool disable_whisper_gpu = should_disable_whisper_gpu(runtime.variant, prefer_cuda, cuda_supported);

    const auto job_safe = sanitize_id(job_id);
    auto output_dir = requested_output_dir(request, job_id, "asr");
    std::error_code error;
    std::filesystem::create_directories(output_dir, error);
    if (error) {
      return {false, "", "InternalError", "Failed to create ASR output directory: " + error.message(), true};
    }

    const auto audio_format = lowercase(std::filesystem::path(media_path).extension().string());
    std::filesystem::path whisper_input = media_path;
    std::optional<std::filesystem::path> extracted_audio;
    if (audio_format != ".wav") {
      const auto ffmpeg = configured_or_found_tool(request, "ffmpegPath", "ffmpeg");
      if (!ffmpeg) {
        return {
            false,
            "",
            "MissingRuntime",
            "whisper.cpp expects WAV input for the native MVP. Provide ffmpegPath or pre-extract a WAV mediaPath.",
            false};
      }

      extracted_audio = output_dir / (job_safe + ".wav");
      std::ostringstream extract_command;
      extract_command << quote_shell_arg(*ffmpeg) << " -y -i " << quote_shell_value(media_path)
                      << " -vn -ac 1 -ar 16000 -c:a pcm_s16le " << quote_shell_arg(*extracted_audio);
      const auto extract_output = run_command_capture(extract_command.str(), runtime.env, runtime.library_paths);
      if (extract_output.exit_code != 0 || !path_exists(*extracted_audio)) {
        return {
            false,
            "",
            "InternalError",
            "ffmpeg pre-extraction for whisper.cpp failed: " + output_excerpt(extract_output.output),
            true};
      }
      whisper_input = *extracted_audio;
    }

    const auto output_base = output_dir / job_safe;
    std::ostringstream command;
    command << quote_shell_value(*binary_path) << " -m " << quote_shell_value(*model_path)
            << " -f " << quote_shell_arg(whisper_input)
            << " -t " << cpu_thread_count
            << " --output-srt --output-json-full --output-file " << quote_shell_arg(output_base);
    const auto whisper_language = normalize_whisper_language_code(source_language);
    if (whisper_language != "auto" && !whisper_language.empty()) {
      command << " -l " << quote_shell_value(whisper_language);
    }
    if (disable_whisper_gpu) {
      command << " -ng";
    }

    const auto output = run_command_capture(command.str(), runtime.env, runtime.library_paths);
    const auto srt_path = output_base.string() + ".srt";
    const auto json_path = output_base.string() + ".json";
    if (output.exit_code != 0 || (!path_exists(srt_path) && !path_exists(json_path))) {
      return {
          false,
          "",
          "InternalError",
          "whisper.cpp transcription failed: " + output_excerpt(output.output),
          true};
    }

    std::vector<SubtitleWarning> warnings;
    warnings.push_back({"NativeWhisperRuntime", "Transcription was produced by a verified local whisper.cpp runtime.", ""});
    if (extracted_audio) {
      warnings.push_back({"AudioPreExtracted", "Input media was converted to mono 16 kHz WAV before transcription.", ""});
    }
    if (use_gpu && !cuda_supported) {
      warnings.push_back({"CudaRuntimeNotDetected", "GPU runtime was requested, but the native backend did not detect CUDA support.", ""});
    }
    if (disable_whisper_gpu) {
      warnings.push_back({"CudaDisabled", "CUDA acceleration was disabled for this whisper.cpp transcription run.", ""});
    }
    std::vector<Segment> segments;
    if (path_exists(srt_path)) {
      const auto srt_text = read_text_file(srt_path);
      if (!srt_text.empty()) {
        segments = parse_srt_text(srt_text, &warnings);
        if (segments.empty()) {
          segments = parse_whisper_timestamped_text(srt_text, &warnings);
        }
      }
    }
    if (segments.empty() && path_exists(json_path)) {
      const auto json_text = read_text_file(json_path);
      if (!json_text.empty()) {
        segments = parse_whisper_json_text(json_text, &warnings);
      }
    }
    if (segments.empty()) {
      return {false, "", "InternalError", "whisper.cpp SRT output did not contain parseable subtitle segments.", true};
    }

    return {
        true,
        document_payload_from_segments(
            segments,
            "doc-" + job_id,
            source_language,
            target_language,
            media_path,
            "native-whisper.cpp",
            asr_provider,
            warnings),
        "",
        "",
        false};
  }
};

}  // namespace translate_ter::backend
