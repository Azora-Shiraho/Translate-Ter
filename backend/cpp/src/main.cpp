#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct CliOptions {
  bool health = false;
  bool stdio_json = false;
  bool help = false;
};

struct SubtitleWarning {
  std::string code;
  std::string message;
  std::string segment_id;
};

struct Segment {
  int index = 0;
  int start_ms = 0;
  int end_ms = 0;
  std::string source_text;
  std::string translated_text;
  std::string status = "new";
  std::vector<std::string> notes;
  double confidence = 0.0;
  bool has_confidence = false;
};

struct CommandOutput {
  int exit_code = 0;
  std::string output;
};

struct NativeResult {
  bool ok = false;
  std::string payload;
  std::string code;
  std::string message;
  bool retryable = false;
};

std::string json_escape(std::string_view input) {
  std::ostringstream stream;
  for (const char ch : input) {
    switch (ch) {
      case '\\':
        stream << "\\\\";
        break;
      case '"':
        stream << "\\\"";
        break;
      case '\n':
        stream << "\\n";
        break;
      case '\r':
        stream << "\\r";
        break;
      case '\t':
        stream << "\\t";
        break;
      default:
        stream << ch;
        break;
    }
  }
  return stream.str();
}

std::string json_unescape(std::string_view input) {
  std::string output;
  output.reserve(input.size());
  for (std::size_t i = 0; i < input.size(); ++i) {
    if (input[i] != '\\' || i + 1 >= input.size()) {
      output.push_back(input[i]);
      continue;
    }
    const char next = input[++i];
    switch (next) {
      case 'n':
        output.push_back('\n');
        break;
      case 'r':
        output.push_back('\r');
        break;
      case 't':
        output.push_back('\t');
        break;
      case '"':
      case '\\':
      case '/':
        output.push_back(next);
        break;
      default:
        output.push_back(next);
        break;
    }
  }
  return output;
}

std::optional<std::string> extract_string(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return json_unescape(match[1].str());
}

std::optional<int> extract_int(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(-?\\d+)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str());
}

std::optional<double> extract_number(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return std::stod(match[1].str());
}

std::optional<bool> extract_bool(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(true|false)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return match[1].str() == "true";
}

bool starts_with(std::string_view value, std::string_view prefix) {
  return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

std::string lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::string sanitize_id(std::string value) {
  if (value.empty()) return "native-job";
  for (char& ch : value) {
    const auto unsigned_ch = static_cast<unsigned char>(ch);
    if (!std::isalnum(unsigned_ch) && ch != '-' && ch != '_') {
      ch = '_';
    }
  }
  return value;
}

bool path_exists(const std::filesystem::path& path) {
  std::error_code error;
  return std::filesystem::exists(path, error) && !std::filesystem::is_directory(path, error);
}

bool directory_exists(const std::filesystem::path& path) {
  std::error_code error;
  return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
}

std::vector<std::filesystem::path> path_entries() {
  std::vector<std::filesystem::path> entries;
  const char* raw_path = std::getenv("PATH");
  if (!raw_path) return entries;

#if defined(_WIN32)
  constexpr char separator = ';';
#else
  constexpr char separator = ':';
#endif

  std::stringstream stream(raw_path);
  std::string item;
  while (std::getline(stream, item, separator)) {
    if (!item.empty()) entries.emplace_back(item);
  }
  return entries;
}

std::optional<std::filesystem::path> find_tool(std::string_view name) {
  const std::filesystem::path direct(name);
  if (direct.has_parent_path() && path_exists(direct)) return direct;

  std::vector<std::string> names{std::string(name)};
#if defined(_WIN32)
  if (direct.extension().empty()) {
    names.push_back(std::string(name) + ".exe");
  }
#endif

  for (const auto& entry : path_entries()) {
    for (const auto& candidate_name : names) {
      const auto candidate = entry / candidate_name;
      if (path_exists(candidate)) return candidate;
    }
  }
  return std::nullopt;
}

std::optional<std::filesystem::path> sibling_tool(const std::string& tool_path, std::string_view sibling_name) {
  if (tool_path.empty()) return std::nullopt;
  const std::filesystem::path path(tool_path);
  if (!path.has_parent_path()) return std::nullopt;
  auto candidate = path.parent_path() / sibling_name;
#if defined(_WIN32)
  if (candidate.extension().empty()) candidate.replace_extension(".exe");
#endif
  if (path_exists(candidate)) return candidate;
  return std::nullopt;
}

std::optional<std::filesystem::path> configured_or_found_tool(
    const std::string& request,
    std::string_view configured_key,
    std::string_view fallback_name) {
  if (const auto configured = extract_string(request, std::string(configured_key))) {
    const std::filesystem::path path(*configured);
    if (path_exists(path)) return path;
  }
  return find_tool(fallback_name);
}

std::string quote_shell_arg(const std::filesystem::path& path) {
  std::string value = path.string();
  std::string quoted = "\"";
  for (const char ch : value) {
    if (ch == '"') quoted += '\\';
    quoted += ch;
  }
  quoted += "\"";
  return quoted;
}

std::string quote_shell_value(std::string_view value) {
  std::string quoted = "\"";
  for (const char ch : value) {
    if (ch == '"') quoted += '\\';
    quoted += ch;
  }
  quoted += "\"";
  return quoted;
}

CommandOutput run_command_capture(std::string command) {
  command += " 2>&1";
  std::array<char, 4096> buffer{};
  CommandOutput result;

#if defined(_WIN32)
  const std::string shell_command = "\"" + command + "\"";
  FILE* pipe = _popen(shell_command.c_str(), "r");
#else
  FILE* pipe = popen(command.c_str(), "r");
#endif

  if (!pipe) {
    result.exit_code = -1;
    result.output = "Failed to start command.";
    return result;
  }

  while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr) {
    result.output += buffer.data();
  }

#if defined(_WIN32)
  result.exit_code = _pclose(pipe);
#else
  result.exit_code = pclose(pipe);
#endif

  return result;
}

std::string read_text_file(const std::filesystem::path& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return "";
  std::ostringstream stream;
  stream << file.rdbuf();
  return stream.str();
}

std::filesystem::path default_work_dir(const std::string& job_id, std::string_view phase) {
  return std::filesystem::temp_directory_path() / "translate-ter" / phase / sanitize_id(job_id);
}

std::string output_excerpt(const std::string& output) {
  constexpr std::size_t max_length = 600;
  if (output.size() <= max_length) return output;
  return output.substr(0, max_length) + "...";
}

std::string without_line_breaks(std::string value) {
  value.erase(std::remove(value.begin(), value.end(), '\r'), value.end());
  value.erase(std::remove(value.begin(), value.end(), '\n'), value.end());
  return value;
}

std::string bool_json(bool value) {
  return value ? "true" : "false";
}

bool detect_cuda_support(const std::vector<std::filesystem::path>& extra_search_roots = {}) {
#if defined(_WIN32)
  const std::array<std::string, 2> cuda_dlls = {"cublas64_11.dll", "cublasLt64_11.dll"};
  std::vector<std::filesystem::path> search_roots = extra_search_roots;
  if (const char* cuda_path = std::getenv("CUDA_PATH")) {
    search_roots.emplace_back(std::filesystem::path(cuda_path) / "bin");
  }
  if (const char* cuda_home = std::getenv("CUDA_HOME")) {
    search_roots.emplace_back(std::filesystem::path(cuda_home) / "bin");
  }
  for (const auto& entry : path_entries()) {
    if (directory_exists(entry)) {
      search_roots.push_back(entry);
    }
  }

  return std::all_of(cuda_dlls.begin(), cuda_dlls.end(), [&](const auto& dll_name) {
    return std::any_of(search_roots.begin(), search_roots.end(), [&](const auto& root) {
      return path_exists(root / dll_name);
    });
  });
#else
  if (std::getenv("CUDA_PATH") != nullptr || std::getenv("CUDA_HOME") != nullptr) {
    return true;
  }

  if (find_tool("nvidia-smi").has_value()) {
    return true;
  }
#endif

  return false;
}

std::filesystem::path requested_output_dir(const std::string& request, const std::string& job_id, std::string_view phase) {
  if (const auto output_dir = extract_string(request, "outputDir")) {
    return std::filesystem::path(*output_dir);
  }
  return default_work_dir(job_id, phase);
}

std::string health_payload() {
  const bool ffmpeg_available = find_tool("ffmpeg").has_value();
  const bool ffprobe_available = find_tool("ffprobe").has_value();
  const bool cuda_supported = detect_cuda_support();
  const bool media_tools_available = ffmpeg_available && ffprobe_available;
  std::ostringstream payload;
  payload << "{\"protocolVersion\":1,\"backendVersion\":\"0.4.0\",\"status\":\""
          << (media_tools_available ? "ok" : "degraded")
          << "\",\"capabilities\":[\"runtime.health\",\"media.probe\",\"audio.extract\",\"srt.parse\",\"srt.serialize\","
             "\"asr.transcribe\",\"job.cancel\"],\"whisperRuntimeAvailable\":false,\"ffmpegAvailable\":"
          << bool_json(ffmpeg_available) << ",\"ffprobeAvailable\":" << bool_json(ffprobe_available)
          << ",\"hardwareAcceleration\":\"" << (cuda_supported ? "gpu" : "cpu") << "\",\"cudaSupported\":"
          << bool_json(cuda_supported) << ",\"recommendedLocalAcceleration\":\"" << (cuda_supported ? "gpu" : "cpu")
          << "\"}";
  return payload.str();
}

std::string response_ok(const std::string& request_id, const std::string& type, const std::string& payload) {
  return "{\"protocolVersion\":1,\"requestId\":\"" + json_escape(request_id) + "\",\"type\":\"" +
         json_escape(type) + "\",\"ok\":true,\"payload\":" + payload + "}";
}

std::string response_error(
    const std::string& request_id,
    const std::string& type,
    const std::string& code,
    const std::string& message,
    bool retryable) {
  return "{\"protocolVersion\":1,\"requestId\":\"" + json_escape(request_id) + "\",\"type\":\"" +
         json_escape(type) + "\",\"ok\":false,\"error\":{\"code\":\"" + json_escape(code) +
         "\",\"message\":\"" + json_escape(message) + "\",\"retryable\":" + (retryable ? "true" : "false") +
         "}}";
}

int normalize_millis(int millis) {
  if (millis < 10) return millis * 100;
  if (millis < 100) return millis * 10;
  return millis;
}

std::optional<int> parse_timestamp_ms(const std::string& timestamp) {
  const std::regex pattern(R"((\d{1,2}):([0-5]\d):([0-5]\d),(\d{1,3}))");
  std::smatch match;
  if (!std::regex_match(timestamp, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str()) * 3600000 + std::stoi(match[2].str()) * 60000 +
         std::stoi(match[3].str()) * 1000 + normalize_millis(std::stoi(match[4].str()));
}

std::optional<int> parse_loose_timestamp_ms(const std::string& timestamp) {
  const std::regex pattern(R"((\d{1,2}):([0-5]\d):([0-5]\d)[\.,](\d{1,3}))");
  std::smatch match;
  if (!std::regex_match(timestamp, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str()) * 3600000 + std::stoi(match[2].str()) * 60000 +
         std::stoi(match[3].str()) * 1000 + normalize_millis(std::stoi(match[4].str()));
}

std::string format_timestamp(int ms) {
  const int hours = ms / 3600000;
  const int minutes = (ms % 3600000) / 60000;
  const int seconds = (ms % 60000) / 1000;
  const int millis = ms % 1000;
  std::ostringstream stream;
  stream << std::setfill('0') << std::setw(2) << hours << ":" << std::setw(2) << minutes << ":"
         << std::setw(2) << seconds << "," << std::setw(3) << millis;
  return stream.str();
}

std::vector<std::string> split_blocks(const std::string& input) {
  std::string normalized;
  normalized.reserve(input.size());
  for (std::size_t i = 0; i < input.size(); ++i) {
    const char ch = input[i];
    if (ch == '\r') {
      if (i + 1 < input.size() && input[i + 1] == '\n') {
        continue;
      }
      normalized.push_back('\n');
      continue;
    }
    normalized.push_back(ch);
  }
  const std::string marker = "\n\n";
  std::vector<std::string> blocks;
  std::size_t start = 0;
  while (start < normalized.size()) {
    while (start < normalized.size() && normalized[start] == '\n') {
      ++start;
    }
    if (start >= normalized.size()) break;
    std::size_t end = normalized.find(marker, start);
    while (end != std::string::npos && end + 2 < normalized.size() && normalized[end + 2] == '\n') {
      ++end;
    }
    if (end == std::string::npos) {
      blocks.push_back(normalized.substr(start));
      break;
    }
    blocks.push_back(normalized.substr(start, end - start));
    start = end + 2;
  }
  return blocks;
}

std::string status_for_notes(const std::vector<std::string>& notes) {
  return notes.empty() ? "transcribed" : "warning";
}

std::string warning_json(const SubtitleWarning& warning) {
  std::ostringstream stream;
  stream << "{\"code\":\"" << json_escape(warning.code) << "\",\"message\":\"" << json_escape(warning.message) << "\"";
  if (!warning.segment_id.empty()) {
    stream << ",\"segmentId\":\"" << json_escape(warning.segment_id) << "\"";
  }
  stream << "}";
  return stream.str();
}

std::vector<Segment> parse_srt_text(
    const std::string& srt,
    std::vector<SubtitleWarning>* warnings,
    std::string* source_language = nullptr,
    std::string* input_media_path = nullptr) {
  std::vector<Segment> segments;
  const std::regex timing_pattern(
      R"((\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3})\s*-->\s*(\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3})(?:\s+.*)?)");
  const auto blocks = split_blocks(srt);
  for (std::size_t block_index = 0; block_index < blocks.size(); ++block_index) {
    std::stringstream lines(blocks[block_index]);
    std::string index_line;
    std::string timing_line;
    if (!std::getline(lines, index_line) || !std::getline(lines, timing_line)) {
      if (warnings) {
        warnings->push_back({"ParseError", "Skipped malformed SRT block " + std::to_string(block_index + 1) + ".", ""});
      }
      continue;
    }

    std::smatch timing;
    if (!std::regex_match(timing_line, timing, timing_pattern)) {
      if (warnings) {
        const std::string block_label = index_line.empty() ? std::to_string(block_index + 1) : index_line;
        warnings->push_back({"ParseError", "Skipped block " + block_label + ": invalid timestamp.", ""});
      }
      continue;
    }

    const auto start = parse_timestamp_ms(timing[1].str());
    const auto end = parse_timestamp_ms(timing[2].str());
    if (!start || !end) {
      if (warnings) {
        warnings->push_back({"ParseError", "Skipped malformed timestamp in block " + std::to_string(block_index + 1) + ".", ""});
      }
      continue;
    }

    std::string text;
    std::string text_line;
    while (std::getline(lines, text_line)) {
      if (!text.empty()) text.push_back('\n');
      text += text_line;
    }

    Segment segment;
    segment.index = static_cast<int>(segments.size()) + 1;
    try {
      segment.index = std::stoi(index_line);
    } catch (...) {
    }
    segment.start_ms = *start;
    segment.end_ms = *end;
    segment.source_text = text;
    segment.confidence = 0.92;
    segment.has_confidence = false;

    const std::string segment_id = "seg-" + [&]() {
      std::ostringstream id_stream;
      id_stream << std::setw(4) << std::setfill('0') << (segments.size() + 1);
      return id_stream.str();
    }();

    if (segment.end_ms <= segment.start_ms) {
      segment.notes.push_back("End time must be after start time.");
      if (warnings) warnings->push_back({"InvalidTiming", "End time must be after start time.", segment_id});
    }
    if (segment.source_text.empty()) {
      segment.notes.push_back("Subtitle text is empty.");
      if (warnings) warnings->push_back({"EmptyText", "Subtitle text is empty.", segment_id});
    }
    if (!segments.empty() && segment.start_ms < segments.back().end_ms) {
      segment.notes.push_back("Timing overlaps with previous segment.");
      if (warnings) warnings->push_back({"TimingOverlap", "Timing overlaps with previous segment.", segment_id});
    }

    segment.status = status_for_notes(segment.notes);
    segments.push_back(segment);
  }

  if (source_language) *source_language = "auto";
  if (input_media_path) *input_media_path = "";
  return segments;
}

std::vector<Segment> parse_whisper_timestamped_text(
    const std::string& text,
    std::vector<SubtitleWarning>* warnings) {
  std::vector<Segment> segments;
  std::stringstream lines(text);
  std::string line;
  const std::regex timing_pattern(
      R"(\[\s*(\d{1,2}:\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[\.,]\d{1,3})\s*\]\s*(.*))");

  while (std::getline(lines, line)) {
    if (line.empty()) continue;
    std::smatch timing;
    if (!std::regex_match(line, timing, timing_pattern)) {
      continue;
    }

    const auto start = parse_loose_timestamp_ms(timing[1].str());
    const auto end = parse_loose_timestamp_ms(timing[2].str());
    if (!start || !end) {
      continue;
    }

    Segment segment;
    segment.index = static_cast<int>(segments.size()) + 1;
    segment.start_ms = *start;
    segment.end_ms = *end;
    segment.source_text = timing[3].str();
    segment.status = "transcribed";
    segment.confidence = 0.92;
    segment.has_confidence = false;
    segments.push_back(segment);
  }

  if (segments.empty() && warnings) {
    warnings->push_back({"ParseError", "Whisper timestamp output did not contain parseable subtitle lines.", ""});
  }
  return segments;
}

std::vector<Segment> parse_whisper_json_text(
    const std::string& json,
    std::vector<SubtitleWarning>* warnings) {
  std::vector<Segment> segments;
  const std::regex segment_pattern(
      R"JSON(\{[^{}]*"offsets"\s*:\s*\{[^{}]*"from"\s*:\s*(\d+)\s*,\s*"to"\s*:\s*(\d+)[^{}]*\}[^{}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"[^{}]*\})JSON");

  auto begin = std::sregex_iterator(json.begin(), json.end(), segment_pattern);
  auto end = std::sregex_iterator();
  for (auto it = begin; it != end; ++it) {
    Segment segment;
    segment.index = static_cast<int>(segments.size()) + 1;
    segment.start_ms = std::stoi((*it)[1].str());
    segment.end_ms = std::stoi((*it)[2].str());
    segment.source_text = json_unescape((*it)[3].str());
    segment.status = "transcribed";
    segment.confidence = 0.92;
    segment.has_confidence = false;
    segments.push_back(segment);
  }

  if (segments.empty() && warnings) {
    warnings->push_back({"ParseError", "Whisper JSON output did not contain parseable segment offsets.", ""});
  }
  return segments;
}

std::string document_payload_from_segments(
    const std::vector<Segment>& segments,
    std::string_view document_id,
    std::string_view source_language,
    std::string_view target_language,
    std::string_view input_media_path,
    std::string_view created_at,
    std::string_view asr_provider,
    const std::vector<SubtitleWarning>& warnings) {
  std::ostringstream payload;
  payload << "{\"document\":{\"id\":\"" << json_escape(document_id) << "\",\"format\":\"srt\",\"sourceLanguage\":\""
          << json_escape(source_language) << "\"";
  if (!target_language.empty()) {
    payload << ",\"targetLanguage\":\"" << json_escape(target_language) << "\"";
  }
  payload << ",\"segments\":[";
  for (std::size_t i = 0; i < segments.size(); ++i) {
    if (i > 0) payload << ",";
    payload << "{\"id\":\"seg-" << std::setw(4) << std::setfill('0') << (i + 1) << "\",\"index\":"
            << segments[i].index << ",\"startMs\":" << segments[i].start_ms << ",\"endMs\":"
            << segments[i].end_ms << ",\"sourceText\":\"" << json_escape(segments[i].source_text) << "\"";
    if (!segments[i].translated_text.empty()) {
      payload << ",\"translatedText\":\"" << json_escape(segments[i].translated_text) << "\"";
    }
    if (segments[i].has_confidence) {
      payload << ",\"confidence\":" << std::fixed << std::setprecision(3) << segments[i].confidence;
    }
    payload << ",\"status\":\"" << json_escape(segments[i].status) << "\"";
    if (!segments[i].notes.empty()) {
      payload << ",\"notes\":[";
      for (std::size_t note_index = 0; note_index < segments[i].notes.size(); ++note_index) {
        if (note_index > 0) payload << ",";
        payload << "\"" << json_escape(segments[i].notes[note_index]) << "\"";
      }
      payload << "]";
    }
    payload << "}";
  }
  payload << "],\"metadata\":{\"createdAt\":\"" << json_escape(created_at) << "\",\"warnings\":[";
  for (std::size_t warning_index = 0; warning_index < warnings.size(); ++warning_index) {
    if (warning_index > 0) payload << ",";
    payload << warning_json(warnings[warning_index]);
  }
  payload << "]";
  if (!input_media_path.empty()) {
    payload << ",\"inputMediaPath\":\"" << json_escape(input_media_path) << "\"";
  }
  if (!asr_provider.empty()) {
    payload << ",\"asrProvider\":\"" << json_escape(asr_provider) << "\"";
  }
  payload << "}}}";
  return payload.str();
}

std::string srt_parse_payload(const std::string& request) {
  const auto srt = extract_string(request, "srt");
  if (!srt) return "";
  const auto source_language = extract_string(request, "sourceLanguage").value_or("auto");
  const auto input_media_path = extract_string(request, "inputMediaPath").value_or("");
  std::vector<SubtitleWarning> warnings;
  const auto segments = parse_srt_text(*srt, &warnings);
  return document_payload_from_segments(
      segments,
      "native-srt",
      source_language,
      "",
      input_media_path,
      "native",
      "",
      warnings);
}

std::vector<Segment> extract_segments_from_request(const std::string& request) {
  std::vector<Segment> segments;
  const std::regex object_pattern("\\{[^{}]*\\\"startMs\\\"\\s*:\\s*-?\\d+[^{}]*\\\"endMs\\\"\\s*:\\s*-?\\d+[^{}]*\\\"sourceText\\\"\\s*:\\s*\\\"(?:\\\\.|[^\\\"\\\\])*\\\"[^{}]*\\}");
  auto begin = std::sregex_iterator(request.begin(), request.end(), object_pattern);
  auto end = std::sregex_iterator();
  for (auto it = begin; it != end; ++it) {
    const std::string object = it->str();
    const auto start = extract_int(object, "startMs");
    const auto finish = extract_int(object, "endMs");
    const auto source_text = extract_string(object, "sourceText");
    if (!start || !finish || !source_text) continue;

    Segment segment;
    segment.index = extract_int(object, "index").value_or(static_cast<int>(segments.size()) + 1);
    segment.start_ms = *start;
    segment.end_ms = *finish;
    segment.source_text = *source_text;
    segment.translated_text = extract_string(object, "translatedText").value_or("");
    segment.status = extract_string(object, "status").value_or("transcribed");
    if (const auto confidence = extract_number(object, "confidence")) {
      segment.confidence = *confidence;
      segment.has_confidence = true;
    }

    const std::regex notes_pattern("\\\"notes\\\"\\s*:\\s*\\[([^\\]]*)\\]");
    std::smatch notes_match;
    if (std::regex_search(object, notes_match, notes_pattern)) {
      const std::string notes_body = notes_match[1].str();
      const std::regex note_item("\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
      auto note_begin = std::sregex_iterator(notes_body.begin(), notes_body.end(), note_item);
      auto note_end = std::sregex_iterator();
      for (auto note_it = note_begin; note_it != note_end; ++note_it) {
        segment.notes.push_back(json_unescape((*note_it)[1].str()));
      }
    }

    segments.push_back(segment);
  }
  return segments;
}

std::string text_for_variant(
    const Segment& segment,
    std::string_view variant,
    std::string_view bilingual_order) {
  if (variant == "source") return segment.source_text;
  if (variant == "translated") return segment.translated_text.empty() ? segment.source_text : segment.translated_text;

  const std::string first = bilingual_order == "target-first"
                                ? (segment.translated_text.empty() ? "" : segment.translated_text)
                                : segment.source_text;
  const std::string second = bilingual_order == "target-first"
                                 ? segment.source_text
                                 : (segment.translated_text.empty() ? "" : segment.translated_text);
  if (first.empty()) return second;
  if (second.empty()) return first;
  return first + "\n" + second;
}

std::string srt_serialize_payload(const std::string& request) {
  auto segments = extract_segments_from_request(request);
  std::sort(segments.begin(), segments.end(), [](const Segment& left, const Segment& right) {
    if (left.start_ms != right.start_ms) return left.start_ms < right.start_ms;
    return left.index < right.index;
  });

  const auto variant = extract_string(request, "variant").value_or("translated");
  const auto bilingual_order = extract_string(request, "bilingualOrder").value_or("source-first");

  std::ostringstream srt;
  for (std::size_t i = 0; i < segments.size(); ++i) {
    srt << (i + 1) << "\n" << format_timestamp(segments[i].start_ms) << " --> "
        << format_timestamp(segments[i].end_ms) << "\n"
        << text_for_variant(segments[i], variant, bilingual_order) << "\n\n";
  }
  return "{\"srt\":\"" + json_escape(srt.str()) + "\"}";
}

NativeResult media_probe_result(const std::string& request) {
  const auto media_path = extract_string(request, "mediaPath");
  if (!media_path || media_path->empty()) {
    return {false, "", "MalformedRequest", "media.probe requires payload.mediaPath.", false};
  }
  if (!path_exists(*media_path)) {
    return {false, "", "MissingRuntime", "Input media file does not exist.", false};
  }

  const auto ffprobe = configured_or_found_tool(request, "ffprobePath", "ffprobe");
  if (!ffprobe) {
    return {
        false,
        "",
        "MissingRuntime",
        "ffprobe is not configured or available on PATH. Provide payload.ffprobePath or install ffmpeg tooling.",
        false};
  }

  std::ostringstream command;
  command << quote_shell_arg(*ffprobe)
          << " -v error -print_format json=compact=1 -show_format -show_streams " << quote_shell_value(*media_path);
  const auto output = run_command_capture(command.str());
  if (output.exit_code != 0 || output.output.empty()) {
    return {
        false,
        "",
        "InternalError",
        "ffprobe failed: " + output_excerpt(output.output),
        true};
  }

  std::ostringstream payload;
  payload << "{\"tool\":\"ffprobe\",\"ffprobePath\":\"" << json_escape(ffprobe->string())
          << "\",\"raw\":" << without_line_breaks(output.output) << "}";
  return {true, payload.str(), "", "", false};
}

NativeResult audio_extract_result(const std::string& request) {
  const auto media_path = extract_string(request, "mediaPath");
  if (!media_path || media_path->empty()) {
    return {false, "", "MalformedRequest", "audio.extract requires payload.mediaPath.", false};
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
        "ffmpeg is not configured or available on PATH. Provide payload.ffmpegPath or install ffmpeg tooling.",
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
    return {false, "", "InternalError", "ffmpeg audio extraction failed: " + output_excerpt(output.output), true};
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
    return {false, "", "InternalError", "ffmpeg completed but no audio output files were found.", true};
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

NativeResult asr_transcribe_result(const std::string& request) {
  const auto asr_provider = extract_string(request, "asrProviderId").value_or("local.whisper.cpp");
  const auto media_path = extract_string(request, "audioPath").value_or(
      extract_string(request, "mediaPath").value_or(""));
  const auto source_language = extract_string(request, "sourceLanguage").value_or("auto");
  const auto target_language = extract_string(request, "targetLanguage").value_or("");
  const auto job_id = extract_string(request, "jobId").value_or("native-job");
  const bool prefer_cuda = extract_bool(request, "preferCuda").value_or(false);

  if (!starts_with(asr_provider, "local.whisper")) {
    return {false, "", "UnsupportedCommand", "Only local.whisper.cpp is supported by the native backend for offline transcription.", false};
  }

  const auto binary_path = extract_string(request, "binaryPath");
  const auto model_path = extract_string(request, "modelPath");
  if (!binary_path || !model_path || binary_path->empty() || model_path->empty()) {
    return {
        false,
        "",
        "MissingRuntime",
        "asr.transcribe requires payload.runtime.binaryPath and payload.runtime.modelPath after SHA-256 verification.",
        false};
  }
  if (!path_exists(*binary_path) || !path_exists(*model_path)) {
    return {
        false,
        "",
        "DownloadRequired",
        "Verified whisper.cpp runtime/model files are not available to the native backend.",
        false};
  }
  if (media_path.empty() || !path_exists(media_path)) {
    return {false, "", "MalformedRequest", "asr.transcribe requires an existing payload.mediaPath.", false};
  }
  const bool cuda_supported = detect_cuda_support({std::filesystem::path(*binary_path).parent_path()});

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
    const auto extract_output = run_command_capture(extract_command.str());
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
          << " --output-srt --output-json-full --output-file " << quote_shell_arg(output_base);
  if (source_language != "auto" && !source_language.empty()) {
    command << " -l " << quote_shell_value(source_language);
  }
  if (!prefer_cuda || !cuda_supported) {
    command << " -ng";
  }

  const auto output = run_command_capture(command.str());
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
  if (prefer_cuda && !cuda_supported) {
    warnings.push_back({"CudaFallback", "CUDA acceleration was requested but the native backend did not detect CUDA support.", ""});
  }
  if (!prefer_cuda) {
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

std::string handle_request(const std::string& line) {
  const auto type = extract_string(line, "type").value_or("");
  const auto request_id = extract_string(line, "requestId").value_or("unknown");
  if (type == "runtime.health") {
    return response_ok(request_id, type, health_payload());
  }
  if (type == "srt.parse") {
    const auto payload = srt_parse_payload(line);
    if (payload.empty()) {
      return response_error(request_id, type, "MalformedRequest", "srt.parse requires payload.srt.", false);
    }
    return response_ok(request_id, type, payload);
  }
  if (type == "srt.serialize") {
    const auto payload = srt_serialize_payload(line);
    return response_ok(request_id, type, payload);
  }
  if (type == "asr.transcribe") {
    const auto result = asr_transcribe_result(line);
    if (!result.ok) {
      return response_error(request_id, type, result.code, result.message, result.retryable);
    }
    return response_ok(request_id, type, result.payload);
  }
  if (type == "media.probe") {
    const auto result = media_probe_result(line);
    if (!result.ok) {
      return response_error(request_id, type, result.code, result.message, result.retryable);
    }
    return response_ok(request_id, type, result.payload);
  }
  if (type == "audio.extract") {
    const auto result = audio_extract_result(line);
    if (!result.ok) {
      return response_error(request_id, type, result.code, result.message, result.retryable);
    }
    return response_ok(request_id, type, result.payload);
  }
  if (type == "job.cancel") {
    return response_ok(request_id, type, R"({"cancelled":true})");
  }
  return response_error(request_id, type.empty() ? "unknown" : type, "UnsupportedCommand", "Unknown native protocol command.", false);
}

void run_stdio_json() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::cout << handle_request(line) << std::endl;
  }
}

void print_health() {
  std::cout << health_payload() << std::endl;
}

void print_help(const char* executable) {
  std::cout
      << "Translate-Ter native backend\n\n"
      << "Usage:\n"
      << "  " << executable << " --health\n"
      << "  " << executable << " --stdio-json\n\n"
      << "Protocol: write one JSON request per line to stdin and read one JSON response per line from stdout.\n";
}

CliOptions parse_args(int argc, char** argv) {
  CliOptions options;
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg(argv[i]);
    if (arg == "--health") {
      options.health = true;
    } else if (arg == "--stdio-json") {
      options.stdio_json = true;
    } else if (arg == "--help" || arg == "-h") {
      options.help = true;
    }
  }
  return options;
}

}  // namespace

int main(int argc, char** argv) {
  const CliOptions options = parse_args(argc, argv);
  if (options.health) {
    print_health();
    return 0;
  }
  if (options.stdio_json) {
    run_stdio_json();
    return 0;
  }
  print_help(argv[0]);
  return options.help || argc == 1 ? 0 : 2;
}
