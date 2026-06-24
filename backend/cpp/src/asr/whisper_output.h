#pragma once

#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "common.h"
#include "protocol/json.h"
#include "subtitle/document.h"

namespace translate_ter::backend {

inline std::vector<Segment> parse_whisper_timestamped_text(
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

inline std::vector<Segment> parse_whisper_json_text(
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

}  // namespace translate_ter::backend
