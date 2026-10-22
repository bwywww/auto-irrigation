#include "Protocol.h"
#include <string.h>

namespace irrigation {
bool LineReader::feed(char ch) {
  if (ch == '\n') {
    const bool valid = !discard_ && size_ > 0;
    buffer_[size_] = '\0'; size_ = 0; discard_ = false; carriageReturn_ = false; return valid;
  }
  if (carriageReturn_) { discard_ = true; return false; }
  if (ch == '\r') { if (size_ >= MAX_FRAME - 1) discard_ = true; carriageReturn_ = true; return false; }
  if (ch < 32 || ch > 126 || size_ >= MAX_FRAME - 1) { discard_ = true; return false; }
  if (!discard_) buffer_[size_++] = ch;
  return false;
}
static bool unsignedNumber(const char *s, uint32_t max, uint32_t &value) {
  if (!s || !*s) return false;
  value = 0;
  for (; *s; ++s) {
    if (*s < '0' || *s > '9') return false;
    const uint8_t digit = *s - '0';
    if (digit > max || value > (max - digit) / 10) return false;
    value = value * 10 + digit;
  }
  return true;
}
bool parseCommand(char *line, Command &c) {
  char *fields[7]; uint8_t count = 1; fields[0] = line;
  for (char *p = line; *p; ++p) if (*p == ',') {
    if (count == 7) return false;
    *p = '\0'; fields[count++] = p + 1;
  }
  if (count < 4 || strcmp(fields[0], "C") || strcmp(fields[1], "1")) return false;
  if (!unsignedNumber(fields[2], UINT32_MAX, c.id)) return false;
  c.a = 0; c.b = 0;
  const char *op = fields[3]; uint32_t a = 0, b = 0;
  if (!strcmp(op, "HB")) { c.operation = Heartbeat; return count == 4 && c.id == 0; }
  if (!c.id) return false;
  if (!strcmp(op, "STATUS")) { c.operation = Status; return count == 4; }
  if (!strcmp(op, "STOP")) { c.operation = Stop; return count == 4; }
  if (!strcmp(op, "RESET")) { c.operation = Reset; return count == 4; }
  if (!strcmp(op, "MODE") && count == 5 && unsignedNumber(fields[4], 2, a)) c.operation = SetMode;
  else if (!strcmp(op, "WATER") && count == 5 && unsignedNumber(fields[4], 30, a) && a > 0) c.operation = Water;
  else if (!strcmp(op, "THRESH") && count == 6 && unsignedNumber(fields[4], 100, a) &&
           unsignedNumber(fields[5], 100, b) && a < b) c.operation = Threshold;
  else return false;
  c.a = uint8_t(a); c.b = uint8_t(b); return true;
}
Result Commands::execute(const Command &c, Controller &controller, uint32_t now) {
  if (c.operation == Heartbeat) { controller.heartbeat(now); return Ok; }
  for (uint8_t i = 0; i < 12; ++i) if (cache_[i].id == c.id && c.id) {
    const Cached &entry = cache_[i];
    if (entry.op != c.operation || entry.a != c.a || entry.b != c.b) return IdConflict;
    // STOP is always safe to repeat, including after a subsequent RESET.
    if (c.operation == Stop) controller.emergency(now);
    return Result(entry.result);
  }
  Result result = BadCommand;
  switch (c.operation) {
    case Status: result = Ok; break;
    case Heartbeat: break;
    case SetMode: result = controller.mode(Mode(c.a), now); break;
    case Water: result = controller.water(c.a, now); break;
    case Stop: controller.emergency(now); result = Ok; break;
    case Reset: result = controller.reset(now); break;
    case Threshold: result = controller.thresholds(c.a, c.b); break;
  }
  cache_[next_] = {c.id, uint8_t(c.operation), c.a, c.b, uint8_t(result)};
  next_ = (next_ + 1) % 12;
  return result;
}
}
