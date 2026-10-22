#pragma once
#include "Controller.h"
#include <stddef.h>

namespace irrigation {
constexpr size_t MAX_FRAME = 192;  // 包含末尾LF；不包含C字符串NUL
class LineReader {
 public:
  bool feed(char value);
  char *line() { return buffer_; }
 private:
  char buffer_[MAX_FRAME];
  uint8_t size_ = 0;
  bool discard_ = false, carriageReturn_ = false;
};
enum Operation : uint8_t { Status, Heartbeat, SetMode, Water, Stop, Reset, Threshold };
struct Command { uint32_t id = 0; Operation operation = Status; uint8_t a = 0, b = 0; };
bool parseCommand(char *line, Command &command);
class Commands {
 public:
  Result execute(const Command &command, Controller &controller, uint32_t now);
 private:
  struct Cached { uint32_t id; uint8_t op, a, b, result; };
  Cached cache_[12] = {};
  uint8_t next_ = 0;
};
}
