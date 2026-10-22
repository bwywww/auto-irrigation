#include "Controller.h"
#include <math.h>

namespace irrigation {
Controller::Controller(const Policy &p) : startPercent(p.start), stopPercent(p.stop), policy_(p) {}
bool Controller::configured() const {
  return policy_.outputsVerified && policy_.soilCalibrated && startPercent < stopPercent &&
         stopPercent <= 100 && policy_.maxOpenMs > 0 && policy_.maxOpenMs <= 60000 &&
         policy_.heartbeatMs > 0 && policy_.staleMs > 0 &&
         policy_.algorithm.baseMs > 0 && policy_.algorithm.minMs > 0 &&
         policy_.algorithm.minMs <= policy_.algorithm.maxMs && policy_.algorithm.maxMs <= 20000;
}
bool Controller::sensorReady(uint32_t now) const {
  return haveSample_ && sampleValid_ && good_ >= 3 && uint32_t(now - sampledAt_) < policy_.staleMs;
}
bool Controller::rainReady(uint32_t now) const {
  return !policy_.rainRequired || (haveRain_ && rainState_ == RainDry && uint32_t(now - rainAt_) < policy_.staleMs);
}
bool Controller::ready(uint32_t now) const { return configured() && !latched_ && sensorReady(now) && rainReady(now); }
uint16_t Controller::faults() const {
  uint16_t rainFault = 0;
  if (policy_.rainRequired) {
    if (rainState_ == RainUnknown) rainFault = NotConfigured;
    else if (rainState_ == RainInvalid) rainFault = RainFault;
    else if (rainState_ != RainDry) rainFault = RainBlocked;
  }
  return latched_ | rainFault | (configured() ? 0 : uint16_t(NotConfigured));
}
void Controller::rain(RainState state, uint32_t now) {
  rainState_ = state; rainAt_ = now; haveRain_ = true;
  if (!rainReady(now)) { cycle_ = false; close(now); }
}
void Controller::close(uint32_t now) {
  if (valve) { valve = false; haveClosed_ = true; closedAt_ = now; }
}
void Controller::open(uint32_t now, uint32_t duration) { valve = true; openedAt_ = now; duration_ = duration; }
void Controller::latch(uint16_t fault, uint32_t now) { latched_ |= fault; cycle_ = false; close(now); currentMode = Standby; }
void Controller::sample(bool valid, uint8_t value, uint32_t now) {
  haveSample_ = true; sampledAt_ = now; sampleValid_ = valid && value <= 100;
  if (sampleValid_) { moisture_ = value; bad_ = 0; if (good_ < 3) ++good_; }
  else { cycle_ = false; good_ = 0; if (bad_ < 3) ++bad_; close(now); if (bad_ >= 3) latch(SoilFault, now); }
}
void Controller::environment(int16_t temperatureCenti, Daylight daylight) {
  temperature_ = temperatureCenti; daylight_ = daylight;
}
uint32_t Controller::pulseMs(uint8_t moisture) const {
  if (startPercent >= stopPercent || moisture >= stopPercent) return 0;
  const Algorithm &a = policy_.algorithm;
  float kt = temperature_ == -32768 ? 1.0F : 1.0F + a.temperatureSlope * (temperature_ / 100.0F - a.referenceC);
  if (kt < a.minTemperature) kt = a.minTemperature;
  if (kt > a.maxTemperature) kt = a.maxTemperature;
  const float kl = daylight_ == Day ? a.dayFactor : daylight_ == Night ? a.nightFactor : 1.0F;
  float ms = float(a.baseMs) * (stopPercent - moisture) / (stopPercent - startPercent) * kt * kl;
  if (ms < a.minMs) ms = a.minMs;
  if (ms > a.maxMs) ms = a.maxMs;
  return uint32_t(lroundf(ms));
}
void Controller::heartbeat(uint32_t now) { haveHeartbeat_ = true; heartbeatAt_ = now; }
void Controller::tick(uint32_t now) {
  if (policy_.rainRequired && haveRain_ && uint32_t(now - rainAt_) >= policy_.staleMs) rainState_ = RainInvalid;
  if (haveSample_ && uint32_t(now - sampledAt_) >= policy_.staleMs) latch(SoilFault, now);
  if (!configured() || latched_ || !sensorReady(now) || !rainReady(now)) { cycle_ = false; close(now); return; }
  // Hard timeout is evaluated before moisture thresholds and mode transitions.
  if (valve && uint32_t(now - openedAt_) >= policy_.maxOpenMs) { latch(WaterTimeout, now); return; }
  if (currentMode == Manual) {
    if (valve && (!haveHeartbeat_ || uint32_t(now - heartbeatAt_) >= policy_.heartbeatMs)) {
      latch(LinkLost, now); return;
    }
    if (valve && uint32_t(now - openedAt_) >= duration_) close(now);
    return;
  }
  if (currentMode != Auto) { cycle_ = false; close(now); return; }
  if (moisture_ >= stopPercent) { cycle_ = false; close(now); return; }
  if (moisture_ <= startPercent) cycle_ = true;
  if (valve) {
    if (uint32_t(now - openedAt_) >= duration_) close(now);
  } else if (cycle_ && cooldown(now) == 0) open(now, pulseMs(moisture_));
}
Result Controller::mode(Mode value, uint32_t now) {
  tick(now);
  if (value > Manual) return BadArgument;
  if (value == Standby) { cycle_ = false; close(now); currentMode = Standby; return Ok; }
  if (latched_) return Locked;
  if (!ready(now)) return NotReady;
  if (value != currentMode) { cycle_ = false; close(now); }
  currentMode = value; tick(now); return Ok;
}
Result Controller::water(uint8_t seconds, uint32_t now) {
  tick(now);
  if (seconds < 1 || seconds > 30) return BadArgument;
  if (latched_) return Locked;
  if (!ready(now)) return NotReady;
  if (currentMode != Manual) return NeedManual;
  if (valve) return Busy;
  if (!haveHeartbeat_ || uint32_t(now - heartbeatAt_) >= policy_.heartbeatMs) return NeedHeartbeat;
  open(now, uint32_t(seconds) * 1000); return Ok;
}
Result Controller::thresholds(uint8_t start, uint8_t stop) {
  if (start >= stop || stop > 100) return BadArgument;
  if (valve) return Busy;
  cycle_ = false; startPercent = start; stopPercent = stop; return Ok;
}
void Controller::emergency(uint32_t now) { latch(Emergency, now); }
Result Controller::reset(uint32_t now) {
  cycle_ = false; close(now); currentMode = Standby;
  if (!sensorReady(now) || !configured() || !rainReady(now)) return NotReady;
  latched_ = 0; return Ok;
}
uint8_t Controller::led() const {
  if (faults()) return 3;
  if (valve) return 2;
  return currentMode == Standby ? 0 : 1;
}
uint32_t Controller::remaining(uint32_t now) const {
  if (!valve) return 0;
  const uint32_t limit = duration_ < policy_.maxOpenMs ? duration_ : policy_.maxOpenMs;
  const uint32_t elapsed = uint32_t(now - openedAt_);
  return elapsed >= limit ? 0 : limit - elapsed;
}
uint32_t Controller::cooldown(uint32_t now) const {
  const uint32_t elapsed = uint32_t(now - closedAt_);
  return !haveClosed_ || elapsed >= policy_.cooldownMs ? 0 : policy_.cooldownMs - elapsed;
}
const char *resultName(Result r) {
  switch (r) {
    case Ok: return "OK"; case BadCommand: return "BAD_COMMAND"; case BadArgument: return "BAD_ARGUMENT";
    case NotReady: return "NOT_READY"; case Locked: return "LOCKED"; case Busy: return "BUSY";
    case NeedManual: return "NEED_MANUAL"; case NeedHeartbeat: return "NEED_HEARTBEAT";
    case IdConflict: return "ID_CONFLICT"; case QueueFull: return "QUEUE_FULL";
  }
  return "BAD_COMMAND";
}
}
