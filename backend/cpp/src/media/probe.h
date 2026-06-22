#pragma once

#include <sstream>
#include <string>

#include "common.h"
#include "protocol/json.h"
#include "runtime/tooling.h"

namespace translate_ter::backend {

inline NativeResult media_probe_result(const std::string& request) {
  const auto media_path = extract_string(request, "mediaPath");
  if (!media_path || media_path->empty()) {
    return {false, "", "MalformedRequest", "The media file to check was not provided.", false};
  }
  if (!path_exists(*media_path)) {
    return {false, "", "MissingRuntime", "Input media file does not exist.", false};
  }

  const auto ffprobe = configured_or_found_tool(request, "ffprobePath", "ffprobe");
  if (!ffprobe) {
    return {
        false,
        "",
        "MissingRuntime",
        "FFprobe is missing, so this file cannot be checked yet.",
        false};
  }

  std::ostringstream command;
  command << quote_shell_arg(*ffprobe)
          << " -v error -print_format json=compact=1 -show_format -show_streams " << quote_shell_value(*media_path);
  const auto output = run_command_capture(command.str());
  if (output.exit_code != 0 || output.output.empty()) {
    return {
        false,
        "",
        "InternalError",
        "The media file could not be checked: " + output_excerpt(output.output),
        true};
  }

  std::ostringstream payload;
  payload << "{\"tool\":\"ffprobe\",\"ffprobePath\":\"" << json_escape(ffprobe->string())
          << "\",\"raw\":" << without_line_breaks(output.output) << "}";
  return {true, payload.str(), "", "", false};
}

}  // namespace translate_ter::backend
