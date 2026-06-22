#pragma once

#include <filesystem>
#include <string>
#include <string_view>

#include "common.h"
#include "protocol/json.h"
#include "runtime/tooling.h"

namespace translate_ter::backend {

inline bool is_supported_runtime_variant(std::string_view variant) {
  return variant == "cpu" || variant == "cuda" || variant == "metal" || variant == "vulkan";
}

inline bool runtime_variant_requests_gpu(const std::optional<std::string>& variant) {
  return variant && (*variant == "cuda" || *variant == "metal" || *variant == "vulkan");
}

inline bool should_disable_whisper_gpu(const std::optional<std::string>& variant, bool prefer_cuda, bool cuda_supported) {
  if (variant.has_value()) {
    return *variant == "cpu";
  }
  return !prefer_cuda || !cuda_supported;
}

inline RuntimePayload parse_runtime_payload(const std::string& request) {
  RuntimePayload runtime;
  if (const auto raw_runtime = extract_object(request, "runtime")) {
    if (const auto provider = extract_string(*raw_runtime, "provider")) {
      runtime.provider = *provider;
    }
    if (const auto variant = extract_string(*raw_runtime, "variant")) {
      runtime.variant = lowercase(*variant);
    }
    runtime.binary_path = extract_string(*raw_runtime, "binaryPath");
    runtime.model_path = extract_string(*raw_runtime, "modelPath");
    runtime.library_paths = extract_string_array(*raw_runtime, "libraryPaths");
    runtime.env = extract_string_map(*raw_runtime, "env");
  }

  if (!runtime.binary_path) {
    runtime.binary_path = extract_string(request, "binaryPath");
  }
  if (!runtime.model_path) {
    runtime.model_path = extract_string(request, "modelPath");
  }

  return runtime;
}

inline std::string resolve_runtime_provider_for_request(const RuntimePayload& runtime) {
  return runtime.provider;
}

inline bool runtime_request_uses_gpu(const RuntimePayload& runtime, bool prefer_cuda) {
  return runtime.variant.has_value() ? runtime_variant_requests_gpu(runtime.variant) : prefer_cuda;
}

inline std::filesystem::path requested_output_dir(const std::string& request, const std::string& job_id, std::string_view phase) {
  if (const auto output_dir = extract_string(request, "outputDir")) {
    return std::filesystem::path(*output_dir);
  }
  return default_work_dir(job_id, phase);
}

}  // namespace translate_ter::backend
