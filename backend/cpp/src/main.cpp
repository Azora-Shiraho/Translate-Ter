#include <algorithm>
#include <cctype>
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

struct Segment {
  int index = 0;
  int start_ms = 0;
  int end_ms = 0;
  std::string text;
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

std::string health_payload() {
  return R"({"protocolVersion":1,"backendVersion":"0.2.0","status":"degraded","capabilities":["runtime.health","srt.parse","srt.serialize","asr.transcribe"],"whisperRuntimeAvailable":false,"hardwareAcceleration":"cpu"})";
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

std::optional<int> parse_timestamp_ms(const std::string& timestamp) {
  const std::regex pattern(R"((\d{1,2}):([0-5]\d):([0-5]\d),(\d{1,3}))");
  std::smatch match;
  if (!std::regex_match(timestamp, match, pattern)) return std::nullopt;
  int millis = std::stoi(match[4].str());
  if (millis < 10) millis *= 100;
  else if (millis < 100) millis *= 10;
  return std::stoi(match[1].str()) * 3600000 + std::stoi(match[2].str()) * 60000 +
         std::stoi(match[3].str()) * 1000 + millis;
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
  std::string normalized = input;
  normalized.erase(std::remove(normalized.begin(), normalized.end(), '\r'), normalized.end());
  std::vector<std::string> blocks;
  std::stringstream stream(normalized);
  std::string line;
  std::string block;
  while (std::getline(stream, line)) {
    if (line.empty()) {
      if (!block.empty()) {
        blocks.push_back(block);
        block.clear();
      }
      continue;
    }
    if (!block.empty()) block.push_back('\n');
    block += line;
  }
  if (!block.empty()) blocks.push_back(block);
  return blocks;
}

std::vector<Segment> parse_srt_text(const std::string& srt) {
  std::vector<Segment> segments;
  const std::regex timing_pattern(R"((\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3})\s*-->\s*(\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3}))");
  for (const auto& block : split_blocks(srt)) {
    std::stringstream lines(block);
    std::string index_line;
    std::string timing_line;
    if (!std::getline(lines, index_line) || !std::getline(lines, timing_line)) continue;
    std::smatch timing;
    if (!std::regex_search(timing_line, timing, timing_pattern)) continue;
    const auto start = parse_timestamp_ms(timing[1].str());
    const auto end = parse_timestamp_ms(timing[2].str());
    if (!start || !end) continue;
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
    segment.text = text;
    segments.push_back(segment);
  }
  return segments;
}

std::string srt_parse_payload(const std::string& request) {
  const auto srt = extract_string(request, "srt");
  if (!srt) return "";
  const auto segments = parse_srt_text(*srt);
  std::ostringstream payload;
  payload << "{\"document\":{\"id\":\"native-srt\",\"format\":\"srt\",\"sourceLanguage\":\"auto\",\"segments\":[";
  for (std::size_t i = 0; i < segments.size(); ++i) {
    if (i > 0) payload << ",";
    payload << "{\"id\":\"seg-" << std::setw(4) << std::setfill('0') << (i + 1) << "\",\"index\":"
            << segments[i].index << ",\"startMs\":" << segments[i].start_ms << ",\"endMs\":"
            << segments[i].end_ms << ",\"sourceText\":\"" << json_escape(segments[i].text)
            << "\",\"status\":\"transcribed\"}";
  }
  payload << "],\"metadata\":{\"createdAt\":\"native\",\"warnings\":[]}}}";
  return payload.str();
}

std::vector<Segment> extract_segments_from_request(const std::string& request) {
  std::vector<Segment> segments;
  const std::regex object_pattern(R"(\{[^{}]*"startMs"\s*:\s*-?\d+[^{}]*"endMs"\s*:\s*-?\d+[^{}]*\})");
  auto begin = std::sregex_iterator(request.begin(), request.end(), object_pattern);
  auto end = std::sregex_iterator();
  for (auto it = begin; it != end; ++it) {
    const std::string object = it->str();
    const auto start = extract_int(object, "startMs");
    const auto finish = extract_int(object, "endMs");
    const auto text = extract_string(object, "sourceText");
    if (!start || !finish || !text) continue;
    Segment segment;
    segment.index = static_cast<int>(segments.size()) + 1;
    segment.start_ms = *start;
    segment.end_ms = *finish;
    segment.text = *text;
    segments.push_back(segment);
  }
  return segments;
}

std::string srt_serialize_payload(const std::string& request) {
  const auto segments = extract_segments_from_request(request);
  std::ostringstream srt;
  for (std::size_t i = 0; i < segments.size(); ++i) {
    srt << (i + 1) << "\n" << format_timestamp(segments[i].start_ms) << " --> "
        << format_timestamp(segments[i].end_ms) << "\n" << segments[i].text << "\n\n";
  }
  return "{\"srt\":\"" + json_escape(srt.str()) + "\"}";
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
    const bool has_runtime_path = line.find("\"binaryPath\"") != std::string::npos;
    const bool has_model_path = line.find("\"modelPath\"") != std::string::npos;
    if (!has_runtime_path || !has_model_path) {
      return response_error(request_id, type, "MissingRuntime", "asr.transcribe requires verified runtime and model paths.", false);
    }
    return response_error(
        request_id,
        type,
        "DownloadRequired",
        "Verified whisper.cpp runtime/model files are not available to the native backend.",
        false);
  }
  if (type == "media.probe" || type == "audio.extract") {
    return response_error(request_id, type, "MissingRuntime", "Media tooling is not configured for the native backend.", false);
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
