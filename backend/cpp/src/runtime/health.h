#pragma once

#include <algorithm>
#include <array>
#include <filesystem>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "protocol/json.h"
#include "runtime/tooling.h"

namespace translate_ter::backend {

namespace detail {

inline std::string bool_json(bool value) {
  return value ? "true" : "false";
}

inline std::string accelerator_health_payload(
    std::string_view variant,
    bool hardware_detected,
    bool runtime_detected,
    bool supported,
    std::string_view message = {}) {
  std::ostringstream payload;
  payload << "{\"variant\":\"" << json_escape(variant) << "\",\"hardwareDetected\":"
          << bool_json(hardware_detected) << ",\"runtimeDetected\":" << bool_json(runtime_detected)
          << ",\"supported\":" << bool_json(supported);
  if (!message.empty()) {
    payload << ",\"message\":\"" << json_escape(message) << "\"";
  }
  payload << "}";
  return payload.str();
}

inline std::optional<std::filesystem::path> find_nvidia_smi_tool() {
  if (const auto tool = find_tool("nvidia-smi")) {
    return tool;
  }

#if defined(_WIN32)
  const std::array<std::filesystem::path, 2> known_paths = {
      std::filesystem::path("C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"),
      std::filesystem::path("C:\\Windows\\System32\\nvidia-smi.exe"),
  };
  for (const auto& candidate : known_paths) {
    if (path_exists(candidate)) return candidate;
  }
#endif

  return std::nullopt;
}

inline bool detect_cuda_hardware_support() {
  return find_nvidia_smi_tool().has_value();
}

inline bool detect_cuda_runtime_support(const std::vector<std::filesystem::path>& extra_search_roots = {}) {
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
  return std::getenv("CUDA_PATH") != nullptr || std::getenv("CUDA_HOME") != nullptr;
#endif
}

inline std::string cuda_accelerator_message(bool hardware_detected, bool runtime_detected, bool supported) {
  if (supported && hardware_detected != runtime_detected) {
    return "CUDA support follows the legacy detector; hardware/runtime split is best-effort.";
  }
  if (!supported && hardware_detected && !runtime_detected) {
    return "NVIDIA hardware was detected, but the CUDA runtime was not detected.";
  }
  if (!supported && !hardware_detected && runtime_detected) {
    return "CUDA runtime files were detected, but NVIDIA hardware was not detected.";
  }
  return "";
}

inline std::string accelerators_health_payload(bool cuda_supported) {
  const bool cuda_hardware_detected = detect_cuda_hardware_support();
  const bool cuda_runtime_detected = detect_cuda_runtime_support();
  const auto cuda_message = cuda_accelerator_message(cuda_hardware_detected, cuda_runtime_detected, cuda_supported);

  std::ostringstream payload;
  payload << "["
          << accelerator_health_payload(
                 "cuda",
                 cuda_hardware_detected,
                 cuda_runtime_detected,
                 cuda_supported,
                 cuda_message)
          << ","
          << accelerator_health_payload("metal", false, false, false, "Metal accelerator detection is not implemented yet.")
          << ","
          << accelerator_health_payload("vulkan", false, false, false, "Vulkan accelerator detection is not implemented yet.")
          << "]";
  return payload.str();
}

}  // namespace detail

inline bool detect_cuda_support(const std::vector<std::filesystem::path>& extra_search_roots = {}) {
#if defined(_WIN32)
  return detail::detect_cuda_runtime_support(extra_search_roots);
#else
  if (detail::detect_cuda_runtime_support(extra_search_roots)) {
    return true;
  }

  if (detail::detect_cuda_hardware_support()) {
    return true;
  }
#endif

  return false;
}

inline std::string health_payload() {
  const bool ffmpeg_available = find_tool("ffmpeg").has_value();
  const bool ffprobe_available = find_tool("ffprobe").has_value();
  const bool cuda_supported = detect_cuda_support();
  const bool media_tools_available = ffmpeg_available && ffprobe_available;
  std::ostringstream payload;
  payload << "{\"protocolVersion\":1,\"backendVersion\":\"0.4.0\",\"status\":\""
          << (media_tools_available ? "ok" : "degraded")
          << "\",\"capabilities\":[\"runtime.health\",\"media.probe\",\"audio.extract\",\"srt.parse\",\"srt.serialize\","
             "\"asr.transcribe\",\"job.cancel\"],\"whisperRuntimeAvailable\":false,\"ffmpegAvailable\":"
          << detail::bool_json(ffmpeg_available) << ",\"ffprobeAvailable\":" << detail::bool_json(ffprobe_available)
          << ",\"hardwareAcceleration\":\"" << (cuda_supported ? "gpu" : "cpu") << "\",\"cudaSupported\":"
          << detail::bool_json(cuda_supported) << ",\"recommendedLocalAcceleration\":\"" << (cuda_supported ? "gpu" : "cpu")
          << "\",\"accelerators\":" << detail::accelerators_health_payload(cuda_supported) << "}";
  return payload.str();
}

}  // namespace translate_ter::backend
