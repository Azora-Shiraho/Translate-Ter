#pragma once

#include <map>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace translate_ter::backend {

inline std::string json_escape(std::string_view input) {
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

inline std::string json_unescape(std::string_view input) {
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

inline std::optional<std::string> extract_string(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return json_unescape(match[1].str());
}

inline std::optional<int> extract_int(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(-?\\d+)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str());
}

inline std::optional<double> extract_number(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return std::stod(match[1].str());
}

inline std::optional<bool> extract_bool(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(true|false)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern)) return std::nullopt;
  return match[1].str() == "true";
}

inline std::optional<std::string> extract_object(const std::string& json, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const auto key_pos = json.find(needle);
  if (key_pos == std::string::npos) return std::nullopt;

  const auto colon_pos = json.find(':', key_pos + needle.size());
  if (colon_pos == std::string::npos) return std::nullopt;

  auto object_start = json.find('{', colon_pos + 1);
  if (object_start == std::string::npos) return std::nullopt;

  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  for (std::size_t index = object_start; index < json.size(); ++index) {
    const char ch = json[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch == '\\' && in_string) {
      escaped = true;
      continue;
    }
    if (ch == '"') {
      in_string = !in_string;
      continue;
    }
    if (in_string) {
      continue;
    }
    if (ch == '{') {
      ++depth;
      continue;
    }
    if (ch == '}') {
      --depth;
      if (depth == 0) {
        return json.substr(object_start, index - object_start + 1);
      }
    }
  }
  return std::nullopt;
}

inline std::optional<std::string> extract_array(const std::string& json, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const auto key_pos = json.find(needle);
  if (key_pos == std::string::npos) return std::nullopt;

  const auto colon_pos = json.find(':', key_pos + needle.size());
  if (colon_pos == std::string::npos) return std::nullopt;

  auto array_start = json.find('[', colon_pos + 1);
  if (array_start == std::string::npos) return std::nullopt;

  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  for (std::size_t index = array_start; index < json.size(); ++index) {
    const char ch = json[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch == '\\' && in_string) {
      escaped = true;
      continue;
    }
    if (ch == '"') {
      in_string = !in_string;
      continue;
    }
    if (in_string) {
      continue;
    }
    if (ch == '[') {
      ++depth;
      continue;
    }
    if (ch == ']') {
      --depth;
      if (depth == 0) {
        return json.substr(array_start, index - array_start + 1);
      }
    }
  }
  return std::nullopt;
}

inline std::vector<std::string> extract_string_array(const std::string& json, const std::string& key) {
  const auto raw_array = extract_array(json, key);
  if (!raw_array) return {};

  std::vector<std::string> values;
  const std::regex pattern(R"regex("((?:\\.|[^"\\])*)")regex");
  for (std::sregex_iterator it(raw_array->begin(), raw_array->end(), pattern), end; it != end; ++it) {
    values.push_back(json_unescape((*it)[1].str()));
  }
  return values;
}

inline std::map<std::string, std::string> extract_string_map(const std::string& json, const std::string& key) {
  const auto raw_object = extract_object(json, key);
  if (!raw_object) return {};

  std::map<std::string, std::string> values;
  const std::regex pattern(R"regex("((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)")regex");
  for (std::sregex_iterator it(raw_object->begin(), raw_object->end(), pattern), end; it != end; ++it) {
    values.emplace(json_unescape((*it)[1].str()), json_unescape((*it)[2].str()));
  }
  return values;
}

}  // namespace translate_ter::backend
