#pragma once

#include <iostream>
#include <string>

#include "protocol/router.h"

namespace translate_ter::backend {

inline void run_stdio_json_loop(const NativeProtocolRouter& router) {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::cout << router.handle_request(line) << std::endl;
  }
}

}  // namespace translate_ter::backend
