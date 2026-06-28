#pragma once

#include <algorithm>
#include <iomanip>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "common.h"
#include "protocol/json.h"

namespace translate_ter::backend {

namespace detail {

inline int normalize_millis(int millis) {
  if (millis < 10) return millis * 100;
  if (millis < 100) return millis * 10;
  return millis;
}

inline std::optional<int> parse_timestamp_ms(const std::string& timestamp) {
  const std::regex pattern(R"((\d{1,2}):([0-5]\d):([0-5]\d),(\d{1,3}))");
  std::smatch match;
  if (!std::regex_match(timestamp, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str()) * 3600000 + std::stoi(match[2].str()) * 60000 +
         std::stoi(match[3].str()) * 1000 + normalize_millis(std::stoi(match[4].str()));
}

inline std::string format_timestamp(int ms) {
  const int hours = ms / 3600000;
  const int minutes = (ms % 3600000) / 60000;
  const int seconds = (ms % 60000) / 1000;
  const int millis = ms % 1000;
  std::ostringstream stream;
  stream << std::setfill('0') << std::setw(2) << hours << ":" << std::setw(2) << minutes << ":"
         << std::setw(2) << seconds << "," << std::setw(3) << millis;
  return stream.str();
}

inline std::vector<std::string> split_blocks(const std::string& input) {
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

inline std::string status_for_notes(const std::vector<std::string>& notes) {
  return notes.empty() ? "transcribed" : "warning";
}

inline bool has_non_whitespace(std::string_view value) {
  return std::any_of(value.begin(), value.end(), [](unsigned char ch) {
    return !std::isspace(ch);
  });
}

inline std::string warning_json(const SubtitleWarning& warning) {
  std::ostringstream stream;
  stream << "{\"code\":\"" << json_escape(warning.code) << "\",\"message\":\"" << json_escape(warning.message) << "\"";
  if (!warning.segment_id.empty()) {
    stream << ",\"segmentId\":\"" << json_escape(warning.segment_id) << "\"";
  }
  stream << "}";
  return stream.str();
}

inline std::vector<std::string> extract_top_level_objects(const std::string& json_array) {
  std::vector<std::string> objects;
  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  std::size_t object_start = std::string::npos;

  for (std::size_t index = 0; index < json_array.size(); ++index) {
    const char ch = json_array[index];
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
      if (depth == 0) {
        object_start = index;
      }
      ++depth;
      continue;
    }
    if (ch == '}') {
      --depth;
      if (depth == 0 && object_start != std::string::npos) {
        objects.push_back(json_array.substr(object_start, index - object_start + 1));
        object_start = std::string::npos;
      }
    }
  }

  return objects;
}

inline std::vector<Segment> extract_segments_from_request(const std::string& request) {
  std::vector<Segment> segments;
  const auto raw_segments = extract_array(request, "segments");
  if (!raw_segments) {
    return segments;
  }

  for (const auto& object : extract_top_level_objects(*raw_segments)) {
    const auto start = extract_int(object, "startMs");
    const auto finish = extract_int(object, "endMs");
    const auto source_text = extract_string(object, "sourceText");
    if (!start || !finish || !source_text) continue;

    Segment segment;
    segment.id = extract_string(object, "id").value_or("");
    segment.index = extract_int(object, "index").value_or(static_cast<int>(segments.size()) + 1);
    segment.start_ms = *start;
    segment.end_ms = *finish;
    segment.source_text = *source_text;
    const auto translated_text = extract_string(object, "translatedText");
    if (translated_text.has_value()) {
      segment.translated_text = *translated_text;
      segment.has_translated_text = true;
    }
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

inline std::string text_for_variant(
    const Segment& segment,
    std::string_view variant,
    std::string_view bilingual_order) {
  if (variant == "source") return segment.source_text;
  if (variant == "translated") {
    return segment.has_translated_text ? segment.translated_text : segment.source_text;
  }

  const std::string translated = segment.has_translated_text ? segment.translated_text : "";
  const std::string first = bilingual_order == "target-first" ? translated : segment.source_text;
  const std::string second = bilingual_order == "target-first"
                                 ? segment.source_text
                                 : translated;
  if (first.empty()) return second;
  if (second.empty()) return first;
  return first + "\n" + second;
}

}  // namespace detail

inline std::optional<int> parse_loose_timestamp_ms(const std::string& timestamp) {
  const std::regex pattern(R"((\d{1,2}):([0-5]\d):([0-5]\d)[\.,](\d{1,3}))");
  std::smatch match;
  if (!std::regex_match(timestamp, match, pattern)) return std::nullopt;
  return std::stoi(match[1].str()) * 3600000 + std::stoi(match[2].str()) * 60000 +
         std::stoi(match[3].str()) * 1000 + detail::normalize_millis(std::stoi(match[4].str()));
}

inline std::vector<Segment> parse_srt_text(
    const std::string& srt,
    std::vector<SubtitleWarning>* warnings,
    std::string* source_language = nullptr,
    std::string* input_media_path = nullptr) {
  std::vector<Segment> segments;
  const std::regex timing_pattern(
      R"((\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3})\s*-->\s*(\d{1,2}:[0-5]\d:[0-5]\d,\d{1,3})(?:\s+.*)?)");
  const auto blocks = detail::split_blocks(srt);
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

    const auto start = detail::parse_timestamp_ms(timing[1].str());
    const auto end = detail::parse_timestamp_ms(timing[2].str());
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

    segment.status = detail::status_for_notes(segment.notes);
    segments.push_back(segment);
  }

  if (source_language) *source_language = "auto";
  if (input_media_path) *input_media_path = "";
  return segments;
}

inline std::string document_payload_from_segments(
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
    if (segments[i].has_translated_text) {
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
    payload << detail::warning_json(warnings[warning_index]);
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

inline std::string srt_parse_payload(const std::string& request) {
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

inline NativeResult srt_serialize_result(const std::string& request) {
  auto segments = detail::extract_segments_from_request(request);
  std::sort(segments.begin(), segments.end(), [](const Segment& left, const Segment& right) {
    if (left.start_ms != right.start_ms) return left.start_ms < right.start_ms;
    return left.index < right.index;
  });

  const auto variant = extract_string(request, "variant").value_or("translated");
  const auto bilingual_order = extract_string(request, "bilingualOrder").value_or("source-first");

  std::ostringstream srt;
  for (std::size_t i = 0; i < segments.size(); ++i) {
    const auto text = detail::text_for_variant(segments[i], variant, bilingual_order);
    if (!detail::has_non_whitespace(text)) {
      const std::string segment_id =
          !segments[i].id.empty() ? segments[i].id : ("seg-" + std::to_string(static_cast<int>(i) + 1));
      return {
          false,
          "",
          "MalformedRequest",
          "Cannot export empty subtitle segment " + segment_id + ".",
          false};
    }
    srt << (i + 1) << "\n" << detail::format_timestamp(segments[i].start_ms) << " --> "
        << detail::format_timestamp(segments[i].end_ms) << "\n" << text << "\n\n";
  }
  return {true, "{\"srt\":\"" + json_escape(srt.str()) + "\"}", "", "", false};
}

}  // namespace translate_ter::backend
