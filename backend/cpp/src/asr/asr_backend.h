#pragma once

#include <string>

#include "common.h"

namespace translate_ter::backend {

class AsrBackend {
 public:
  virtual ~AsrBackend() = default;

  virtual bool supports(const RuntimePayload& runtime, const std::string& request) const = 0;
  virtual bool can_reject_unmatched_request(const RuntimePayload& runtime, const std::string& request) const {
    (void)runtime;
    (void)request;
    return false;
  }
  virtual NativeResult transcribe(const std::string& request) const = 0;
};

}  // namespace translate_ter::backend
