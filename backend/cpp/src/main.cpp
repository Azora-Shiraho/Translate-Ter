#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "asr/whisper_cpp_cli_backend.h"
#include "protocol/router.h"
#include "protocol/stdio_loop.h"
#include "runtime/health.h"
#include "runtime/selftest.h"

namespace {

struct CliOptions {
  bool health = false;
  bool stdio_json = false;
  bool help = false;
  bool selftest = false;
};

void print_help(const char* executable) {
  std::cout
      << "Translate-Ter native backend\n\n"
      << "Usage:\n"
      << "  " << executable << " --health\n"
      << "  " << executable << " --stdio-json\n"
      << "  " << executable << " --selftest\n\n"
      << "Protocol: write one JSON request per line to stdin and read one JSON response per line from stdout.\n";
}

CliOptions parse_args(int argc, char** argv) {
  CliOptions options;
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg(argv[i]);
    if (arg == "--health") {
      options.health = true;
    } else if (arg == "--stdio-json") {
      options.stdio_json = true;
    } else if (arg == "--selftest") {
      options.selftest = true;
    } else if (arg == "--help" || arg == "-h") {
      options.help = true;
    }
  }
  return options;
}

}  // namespace

int main(int argc, char** argv) {
  using translate_ter::backend::AsrBackend;
  using translate_ter::backend::NativeProtocolRouter;
  using translate_ter::backend::WhisperCppCliBackend;

  const CliOptions options = parse_args(argc, argv);
  if (options.selftest) {
    return translate_ter::backend::run_selftest() ? 0 : 1;
  }

  std::vector<std::shared_ptr<AsrBackend>> asr_backends;
  asr_backends.push_back(std::make_shared<WhisperCppCliBackend>());
  const NativeProtocolRouter router(std::move(asr_backends));

  if (options.health) {
    std::cout << translate_ter::backend::health_payload() << std::endl;
    return 0;
  }
  if (options.stdio_json) {
    translate_ter::backend::run_stdio_json_loop(router);
    return 0;
  }
  print_help(argv[0]);
  return options.help || argc == 1 ? 0 : 2;
}
