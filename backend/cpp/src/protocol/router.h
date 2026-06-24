#pragma once

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "asr/asr_backend.h"
#include "asr/dispatcher.h"
#include "media/audio_extract.h"
#include "media/probe.h"
#include "protocol/json.h"
#include "runtime/health.h"
#include "subtitle/document.h"

namespace translate_ter::backend {

class NativeProtocolRouter {
 public:
  explicit NativeProtocolRouter(std::vector<std::shared_ptr<AsrBackend>> asr_backends)
      : asr_backends_(std::move(asr_backends)) {}

  std::string handle_request(const std::string& line) const {
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
      const auto result = transcribe_with_backends(line, asr_backends_);
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

 private:
  static std::string response_ok(const std::string& request_id, const std::string& type, const std::string& payload) {
    return "{\"protocolVersion\":1,\"requestId\":\"" + json_escape(request_id) + "\",\"type\":\"" +
           json_escape(type) + "\",\"ok\":true,\"payload\":" + payload + "}";
  }

  static std::string response_error(
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

  std::vector<std::shared_ptr<AsrBackend>> asr_backends_;
};

}  // namespace translate_ter::backend
