#pragma once

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

#include "common.h"
#include "protocol/json.h"

namespace translate_ter::backend {

inline std::string quote_shell_arg(const std::filesystem::path& path);
inline std::string quote_shell_value(std::string_view value);

namespace detail {

inline bool is_safe_environment_key(std::string_view key) {
  if (key.empty()) return false;
  for (const char ch : key) {
    const auto unsigned_ch = static_cast<unsigned char>(ch);
    if (!(std::isalnum(unsigned_ch) || ch == '_')) {
      return false;
    }
  }
  return true;
}

inline std::string merged_path_value(
    const std::vector<std::string>& runtime_library_paths,
    const std::map<std::string, std::string>& runtime_env) {
#if defined(_WIN32)
  constexpr char separator = ';';
#else
  constexpr char separator = ':';
#endif

  std::vector<std::string> parts;
  for (const auto& entry : runtime_library_paths) {
    if (!entry.empty()) {
      parts.push_back(entry);
    }
  }

  if (const auto it = runtime_env.find("PATH"); it != runtime_env.end() && !it->second.empty()) {
    parts.push_back(it->second);
  }

  if (const char* existing_path = std::getenv("PATH"); existing_path != nullptr && std::strlen(existing_path) > 0) {
    parts.push_back(existing_path);
  }

  std::ostringstream stream;
  for (std::size_t index = 0; index < parts.size(); ++index) {
    if (index > 0) {
      stream << separator;
    }
    stream << parts[index];
  }
  return stream.str();
}

inline void set_child_environment_value(
    std::map<std::string, std::string>& environment,
    const std::string& key,
    const std::string& value) {
  if (!is_safe_environment_key(key)) return;
  for (auto it = environment.begin(); it != environment.end();) {
    if (lowercase(it->first) == lowercase(key)) {
      it = environment.erase(it);
    } else {
      ++it;
    }
  }
  environment[key] = value;
}

inline std::map<std::string, std::string> current_child_environment() {
  std::map<std::string, std::string> environment;
#if defined(_WIN32)
  LPCH raw_environment = GetEnvironmentStringsA();
  if (!raw_environment) return environment;
  for (LPCH entry = raw_environment; *entry != '\0'; entry += std::strlen(entry) + 1) {
    const std::string item(entry);
    const auto separator = item.find('=');
    if (separator == std::string::npos || separator == 0) continue;
    environment[item.substr(0, separator)] = item.substr(separator + 1);
  }
  FreeEnvironmentStringsA(raw_environment);
#else
  for (char** entry = environ; entry != nullptr && *entry != nullptr; ++entry) {
    const std::string item(*entry);
    const auto separator = item.find('=');
    if (separator == std::string::npos || separator == 0) continue;
    environment[item.substr(0, separator)] = item.substr(separator + 1);
  }
#endif
  return environment;
}

inline std::map<std::string, std::string> child_environment_with_overrides(
    const std::map<std::string, std::string>& runtime_env,
    const std::vector<std::string>& runtime_library_paths) {
  auto environment = current_child_environment();
  for (const auto& [key, value] : runtime_env) {
    set_child_environment_value(environment, key, value);
  }

  const auto merged_path = merged_path_value(runtime_library_paths, runtime_env);
  if (!merged_path.empty()) {
    set_child_environment_value(environment, "PATH", merged_path);
  }
  return environment;
}

#if defined(_WIN32)
inline std::vector<char> windows_environment_block(const std::map<std::string, std::string>& environment) {
  std::vector<char> block;
  for (const auto& [key, value] : environment) {
    const auto entry = key + "=" + value;
    block.insert(block.end(), entry.begin(), entry.end());
    block.push_back('\0');
  }
  block.push_back('\0');
  return block;
}

inline CommandOutput run_shell_command_with_environment(
    const std::string& command,
    const std::map<std::string, std::string>& environment) {
  CommandOutput result;
  SECURITY_ATTRIBUTES security_attributes{};
  security_attributes.nLength = sizeof(SECURITY_ATTRIBUTES);
  security_attributes.bInheritHandle = TRUE;

  HANDLE read_pipe = nullptr;
  HANDLE write_pipe = nullptr;
  if (!CreatePipe(&read_pipe, &write_pipe, &security_attributes, 0)) {
    result.exit_code = -1;
    result.output = "Failed to create command output pipe.";
    return result;
  }
  SetHandleInformation(read_pipe, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOA startup_info{};
  startup_info.cb = sizeof(STARTUPINFOA);
  startup_info.dwFlags = STARTF_USESTDHANDLES;
  startup_info.hStdOutput = write_pipe;
  startup_info.hStdError = write_pipe;
  startup_info.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

  PROCESS_INFORMATION process_info{};
  const char* comspec = std::getenv("COMSPEC");
  const std::string shell = comspec && std::strlen(comspec) > 0 ? comspec : "C:\\Windows\\System32\\cmd.exe";
  std::string command_line = quote_shell_arg(shell) + " /S /C \"" + command + "\"";
  std::vector<char> mutable_command(command_line.begin(), command_line.end());
  mutable_command.push_back('\0');
  auto environment_block = windows_environment_block(environment);

  const BOOL started = CreateProcessA(
      nullptr,
      mutable_command.data(),
      nullptr,
      nullptr,
      TRUE,
      CREATE_NO_WINDOW,
      environment_block.data(),
      nullptr,
      &startup_info,
      &process_info);
  CloseHandle(write_pipe);

  if (!started) {
    CloseHandle(read_pipe);
    result.exit_code = -1;
    result.output = "Failed to start command.";
    return result;
  }

  std::array<char, 4096> buffer{};
  DWORD bytes_read = 0;
  while (ReadFile(read_pipe, buffer.data(), static_cast<DWORD>(buffer.size()), &bytes_read, nullptr) && bytes_read > 0) {
    result.output.append(buffer.data(), bytes_read);
  }

  WaitForSingleObject(process_info.hProcess, INFINITE);
  DWORD exit_code = 0;
  if (GetExitCodeProcess(process_info.hProcess, &exit_code)) {
    result.exit_code = static_cast<int>(exit_code);
  } else {
    result.exit_code = -1;
  }

  CloseHandle(process_info.hThread);
  CloseHandle(process_info.hProcess);
  CloseHandle(read_pipe);
  return result;
}
#else
inline CommandOutput run_shell_command_with_environment(
    const std::string& command,
    const std::map<std::string, std::string>& environment) {
  CommandOutput result;
  int pipe_fds[2]{};
  if (pipe(pipe_fds) != 0) {
    result.exit_code = -1;
    result.output = "Failed to create command output pipe.";
    return result;
  }

  std::vector<std::string> environment_entries;
  environment_entries.reserve(environment.size());
  for (const auto& [key, value] : environment) {
    environment_entries.push_back(key + "=" + value);
  }
  std::vector<char*> environment_pointers;
  environment_pointers.reserve(environment_entries.size() + 1);
  for (auto& entry : environment_entries) {
    environment_pointers.push_back(entry.data());
  }
  environment_pointers.push_back(nullptr);

  const pid_t child = fork();
  if (child == -1) {
    close(pipe_fds[0]);
    close(pipe_fds[1]);
    result.exit_code = -1;
    result.output = "Failed to start command.";
    return result;
  }

  if (child == 0) {
    close(pipe_fds[0]);
    dup2(pipe_fds[1], STDOUT_FILENO);
    dup2(pipe_fds[1], STDERR_FILENO);
    close(pipe_fds[1]);
    execle("/bin/sh", "sh", "-c", command.c_str(), static_cast<char*>(nullptr), environment_pointers.data());
    _exit(127);
  }

  close(pipe_fds[1]);
  std::array<char, 4096> buffer{};
  ssize_t bytes_read = 0;
  while ((bytes_read = read(pipe_fds[0], buffer.data(), buffer.size())) > 0) {
    result.output.append(buffer.data(), static_cast<std::size_t>(bytes_read));
  }
  close(pipe_fds[0]);

  int status = 0;
  waitpid(child, &status, 0);
  if (WIFEXITED(status)) {
    result.exit_code = WEXITSTATUS(status);
  } else if (WIFSIGNALED(status)) {
    result.exit_code = 128 + WTERMSIG(status);
  } else {
    result.exit_code = -1;
  }
  return result;
}
#endif

}  // namespace detail

inline bool path_exists(const std::filesystem::path& path) {
  std::error_code error;
  return std::filesystem::exists(path, error) && !std::filesystem::is_directory(path, error);
}

inline bool directory_exists(const std::filesystem::path& path) {
  std::error_code error;
  return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
}

inline std::vector<std::filesystem::path> path_entries() {
  std::vector<std::filesystem::path> entries;
  const char* raw_path = std::getenv("PATH");
  if (!raw_path) return entries;

#if defined(_WIN32)
  constexpr char separator = ';';
#else
  constexpr char separator = ':';
#endif

  std::stringstream stream(raw_path);
  std::string item;
  while (std::getline(stream, item, separator)) {
    if (!item.empty()) entries.emplace_back(item);
  }
  return entries;
}

inline std::optional<std::filesystem::path> find_tool(std::string_view name) {
  const std::filesystem::path direct(name);
  if (direct.has_parent_path() && path_exists(direct)) return direct;

  std::vector<std::string> names{std::string(name)};
#if defined(_WIN32)
  if (direct.extension().empty()) {
    names.push_back(std::string(name) + ".exe");
  }
#endif

  for (const auto& entry : path_entries()) {
    for (const auto& candidate_name : names) {
      const auto candidate = entry / candidate_name;
      if (path_exists(candidate)) return candidate;
    }
  }
  return std::nullopt;
}

inline std::optional<std::filesystem::path> configured_or_found_tool(
    const std::string& request,
    std::string_view configured_key,
    std::string_view fallback_name) {
  if (const auto configured = extract_string(request, std::string(configured_key))) {
    const std::filesystem::path path(*configured);
    if (path_exists(path)) return path;
  }
  return find_tool(fallback_name);
}

inline std::string quote_shell_arg(const std::filesystem::path& path) {
  std::string value = path.string();
  std::string quoted = "\"";
  for (const char ch : value) {
    if (ch == '"') quoted += '\\';
    quoted += ch;
  }
  quoted += "\"";
  return quoted;
}

inline std::string quote_shell_value(std::string_view value) {
  std::string quoted = "\"";
  for (const char ch : value) {
    if (ch == '"') quoted += '\\';
    quoted += ch;
  }
  quoted += "\"";
  return quoted;
}

inline std::string normalize_whisper_language_code(std::string language_code) {
  std::transform(language_code.begin(), language_code.end(), language_code.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (language_code.empty() || language_code == "auto") return "auto";
  const auto separator = language_code.find('-');
  if (separator == std::string::npos) return language_code;
  return language_code.substr(0, separator);
}

inline CommandOutput run_command_capture(
    std::string command,
    const std::map<std::string, std::string>& runtime_env = {},
    const std::vector<std::string>& runtime_library_paths = {}) {
  const auto environment = detail::child_environment_with_overrides(runtime_env, runtime_library_paths);
  return detail::run_shell_command_with_environment(command, environment);
}

inline std::string read_text_file(const std::filesystem::path& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return "";
  std::ostringstream stream;
  stream << file.rdbuf();
  return stream.str();
}

inline std::filesystem::path default_work_dir(const std::string& job_id, std::string_view phase) {
  return std::filesystem::temp_directory_path() / "translate-ter" / phase / sanitize_id(job_id);
}

inline std::string output_excerpt(const std::string& output) {
  constexpr std::size_t max_length = 600;
  if (output.size() <= max_length) return output;
  return output.substr(0, max_length) + "...";
}

inline std::string without_line_breaks(std::string value) {
  value.erase(std::remove(value.begin(), value.end(), '\r'), value.end());
  value.erase(std::remove(value.begin(), value.end(), '\n'), value.end());
  return value;
}

}  // namespace translate_ter::backend
