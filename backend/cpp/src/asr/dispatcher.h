#pragma once

#include <memory>
#include <string>
#include <vector>

#include "asr/asr_backend.h"
#include "common.h"
#include "runtime/request.h"

namespace translate_ter::backend {

inline NativeResult transcribe_with_backends(
    const std::string& request,
    const std::vector<std::shared_ptr<AsrBackend>>& backends) {
  const auto runtime = parse_runtime_payload(request);
  for (const auto& backend : backends) {
    if (backend && backend->supports(runtime, request)) {
      return backend->transcribe(request);
    }
  }

  for (const auto& backend : backends) {
    if (backend && backend->can_reject_unmatched_request(runtime, request)) {
      return backend->transcribe(request);
    }
  }

  return {
      false,
      "",
      "UnsupportedCommand",
      "No native ASR backend matched this request.",
      false};
}

}  // namespace translate_ter::backend
