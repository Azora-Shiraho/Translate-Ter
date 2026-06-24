#pragma once

#include <algorithm>
#include <filesystem>
#include <iomanip>
#include <sstream>
#include <string>

#include "common.h"
#include "protocol/json.h"
#include "runtime/request.h"
#include "runtime/tooling.h"

namespace translate_ter::backend {

inline NativeResult audio_extract_result(const std::string& request) {
  const auto media_path = extract_string(request, "mediaPath");
  if (!media_path || media_path->empty()) {
    return {false, "", "MalformedRequest", "The media file for audio extraction was not provided.", false};
  }
  if (!path_exists(*media_path)) {
    return {false, "", "MissingRuntime", "Input media file does not exist.", false};
  }

  const auto ffmpeg = configured_or_found_tool(request, "ffmpegPath", "ffmpeg");
  if (!ffmpeg) {
    return {
        false,
        "",
        "MissingRuntime",
        "FFmpeg is missing, so audio cannot be extracted yet.",
        false};
  }

  const auto job_id = extract_string(request, "jobId").value_or("native-job");
  auto output_dir = requested_output_dir(request, job_id, "audio");
  std::error_code error;
  std::filesystem::create_directories(output_dir, error);
  if (error) {
    return {false, "", "InternalError", "Failed to create audio output directory: " + error.message(), true};
  }

  const auto audio_codec = extract_string(request, "audioCodec").value_or("pcm_s16le");
  const auto format = extract_string(request, "format").value_or("wav");
  const int sample_rate = extract_int(request, "sampleRate").value_or(16000);
  const int channels = extract_int(request, "channels").value_or(1);
  const auto requested_segment_seconds = extract_int(request, "segmentSeconds");
  const int segment_seconds =
      requested_segment_seconds.value_or(extract_int(request, "segmentDurationSec").value_or(0));
  const int start_ms = extract_int(request, "startMs").value_or(0);
  const int duration_ms = extract_int(request, "durationMs").value_or(0);
  const bool split = segment_seconds > 0;
  const std::string safe_job_id = sanitize_id(job_id);

  const auto output_path = split ? output_dir / (safe_job_id + "-%03d." + format)
                                 : output_dir / (safe_job_id + "." + format);

  std::ostringstream command;
  command << quote_shell_arg(*ffmpeg) << " -y";
  if (start_ms > 0) {
    command << " -ss " << std::fixed << std::setprecision(3) << (static_cast<double>(start_ms) / 1000.0);
  }
  command << " -i " << quote_shell_value(*media_path);
  if (duration_ms > 0) {
    command << " -t " << std::fixed << std::setprecision(3) << (static_cast<double>(duration_ms) / 1000.0);
  }
  command << " -vn -ac " << channels << " -ar " << sample_rate << " -c:a " << audio_codec;
  if (split) {
    command << " -f segment -segment_time " << segment_seconds << " -reset_timestamps 1";
  }
  command << " " << quote_shell_arg(output_path);

  const auto output = run_command_capture(command.str());
  if (output.exit_code != 0) {
    return {false, "", "InternalError", "Audio could not be extracted: " + output_excerpt(output.output), true};
  }

  std::vector<std::filesystem::path> files;
  if (split) {
    const std::string prefix = safe_job_id + "-";
    const std::string suffix = "." + format;
    for (const auto& entry : std::filesystem::directory_iterator(output_dir, error)) {
      if (error) break;
      if (!entry.is_regular_file()) continue;
      const auto name = entry.path().filename().string();
      if (starts_with(name, prefix) && name.size() > suffix.size() &&
          name.substr(name.size() - suffix.size()) == suffix) {
        files.push_back(entry.path());
      }
    }
    std::sort(files.begin(), files.end());
  } else if (path_exists(output_path)) {
    files.push_back(output_path);
  }

  if (files.empty()) {
    return {false, "", "InternalError", "Audio extraction finished, but no audio file was created.", true};
  }

  std::ostringstream payload;
  payload << "{\"tool\":\"ffmpeg\",\"ffmpegPath\":\"" << json_escape(ffmpeg->string())
          << "\",\"sampleRate\":" << sample_rate << ",\"channels\":" << channels
          << ",\"format\":\"" << json_escape(format) << "\",\"segmentSeconds\":" << segment_seconds
          << ",\"files\":[";
  for (std::size_t i = 0; i < files.size(); ++i) {
    if (i > 0) payload << ",";
    std::uintmax_t size = 0;
    std::error_code size_error;
    size = std::filesystem::file_size(files[i], size_error);
    payload << "{\"path\":\"" << json_escape(files[i].string()) << "\",\"index\":" << i
            << ",\"startMs\":" << (split ? static_cast<int>(i) * segment_seconds * 1000 : start_ms);
    if (split) {
      payload << ",\"durationMs\":" << segment_seconds * 1000;
    } else if (duration_ms > 0) {
      payload << ",\"durationMs\":" << duration_ms;
    }
    payload << ",\"sizeBytes\":" << (size_error ? 0 : size) << "}";
  }
  payload << "]}";
  return {true, payload.str(), "", "", false};
}

}  // namespace translate_ter::backend
