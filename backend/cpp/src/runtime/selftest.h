#pragma once

#include "runtime/request.h"

namespace translate_ter::backend {

inline bool run_selftest() {
  const auto legacy_gpu = parse_runtime_payload(R"({"payload":{"preferCuda":true,"binaryPath":"C:/top/whisper.exe","modelPath":"C:/top/model.bin"}})");
  if (legacy_gpu.binary_path.value_or("") != "C:/top/whisper.exe") return false;
  if (legacy_gpu.model_path.value_or("") != "C:/top/model.bin") return false;
  if (runtime_request_uses_gpu(legacy_gpu, true) != true) return false;
  if (should_disable_whisper_gpu(legacy_gpu.variant, true, true) != false) return false;
  if (should_disable_whisper_gpu(legacy_gpu.variant, true, false) != true) return false;
  if (should_disable_whisper_gpu(legacy_gpu.variant, false, true) != true) return false;

  const auto nested_cpu = parse_runtime_payload(
      R"({"payload":{"preferCuda":true,"runtime":{"provider":"whisper.cpp","variant":"cpu","binaryPath":"C:/nested/whisper.exe","modelPath":"C:/nested/model.bin"}}})");
  if (resolve_runtime_provider_for_request(nested_cpu) != "whisper.cpp") return false;
  if (nested_cpu.binary_path.value_or("") != "C:/nested/whisper.exe") return false;
  if (nested_cpu.model_path.value_or("") != "C:/nested/model.bin") return false;
  if (runtime_request_uses_gpu(nested_cpu, true) != false) return false;
  if (should_disable_whisper_gpu(nested_cpu.variant, true, true) != true) return false;
  if (should_disable_whisper_gpu(nested_cpu.variant, true, false) != true) return false;

  const auto nested_gpu = parse_runtime_payload(
      R"({"payload":{"preferCuda":false,"runtime":{"provider":"whisper.cpp","variant":"metal","binaryPath":"C:/nested/whisper.exe","modelPath":"C:/nested/model.bin"}}})");
  if (runtime_request_uses_gpu(nested_gpu, false) != true) return false;
  if (should_disable_whisper_gpu(nested_gpu.variant, false, true) != false) return false;
  if (should_disable_whisper_gpu(nested_gpu.variant, false, false) != false) return false;

  const auto unsupported_provider = parse_runtime_payload(
      R"({"payload":{"runtime":{"provider":"faster-whisper","variant":"cuda","binaryPath":"C:/nested/whisper.exe","modelPath":"C:/nested/model.bin"}}})");
  if (resolve_runtime_provider_for_request(unsupported_provider) != "faster-whisper") return false;

  return true;
}

}  // namespace translate_ter::backend
