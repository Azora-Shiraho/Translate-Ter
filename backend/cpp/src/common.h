#pragma once

#include <algorithm>
#include <cctype>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace translate_ter::backend {

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

struct RuntimePayload {
  std::string provider = "whisper.cpp";
  std::optional<std::string> variant;
  std::optional<std::string> binary_path;
  std::optional<std::string> model_path;
  std::vector<std::string> library_paths;
  std::map<std::string, std::string> env;
};

inline int default_whisper_thread_count() {
  const auto hardware_threads = std::thread::hardware_concurrency();
  const auto resolved_threads = hardware_threads == 0 ? 4u : hardware_threads;
  const auto suggested_threads = std::max(1u, std::min(16u, (resolved_threads + 1u) / 2u));
  return static_cast<int>(suggested_threads);
}

inline bool starts_with(std::string_view value, std::string_view prefix) {
  return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

inline std::string lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

inline std::string sanitize_id(std::string value) {
  if (value.empty()) return "native-job";
  for (char& ch : value) {
    const auto unsigned_ch = static_cast<unsigned char>(ch);
    if (!std::isalnum(unsigned_ch) && ch != '-' && ch != '_') {
      ch = '_';
    }
  }
  return value;
}

}  // namespace translate_ter::backend
