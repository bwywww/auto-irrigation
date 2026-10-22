#pragma once
#include <stdint.h>

namespace irrigation {
enum Mode : uint8_t { Standby = 0, Auto = 1, Manual = 2 };
enum Daylight : uint8_t { DayUnknown = 0, Day = 1, Night = 2 };
enum RainState : uint8_t { RainUnknown = 0, RainDry = 1, RainWet = 2, RainDrying = 3, RainInvalid = 4 };
enum Fault : uint16_t { SoilFault = 1, WaterTimeout = 2, Emergency = 4, LinkLost = 8,
                       TemperatureFault = 16, LightFault = 32, NotConfigured = 64,
                       RainBlocked = 128, RainFault = 256 };
enum Result : uint8_t { Ok, BadCommand, BadArgument, NotReady, Locked, Busy, NeedManual,
                        NeedHeartbeat, IdConflict, QueueFull };
struct Algorithm {
  uint32_t baseMs = 5000, minMs = 2000, maxMs = 20000;
  float referenceC = 25, temperatureSlope = 0.02F, minTemperature = 0.8F, maxTemperature = 1.2F;
  float dayFactor = 1.1F, nightFactor = 0.9F;
};
struct Policy {
  bool outputsVerified;
  bool soilCalibrated;
  bool rainRequired;
  Algorithm algorithm;
  uint32_t maxOpenMs, cooldownMs, heartbeatMs, staleMs;
  uint8_t start, stop;
  Policy(bool outputs, bool soil, uint32_t maximum = 60000, uint32_t cooldown = 300000,
         uint32_t heartbeat = 5000, uint32_t stale = 3500, uint8_t low = 30, uint8_t high = 45,
         bool requireRain = false)
    : outputsVerified(outputs), soilCalibrated(soil), rainRequired(requireRain), maxOpenMs(maximum), cooldownMs(cooldown),
      heartbeatMs(heartbeat), staleMs(stale), start(low), stop(high) {}
};
class Controller {
 public:
  explicit Controller(const Policy &policy);
  void sample(bool valid, uint8_t moisture, uint32_t now);
  void heartbeat(uint32_t now);
  void environment(int16_t temperatureCenti, Daylight daylight);
  uint32_t pulseMs(uint8_t moisture) const;
  bool cycleActive() const { return cycle_; }
  uint32_t plannedMs() const { return currentMode == Auto && valve ? duration_ : 0; }
  void rain(RainState state, uint32_t now);
  RainState rainState() const { return rainState_; }
  void tick(uint32_t now);
  Result mode(Mode value, uint32_t now);
  Result water(uint8_t seconds, uint32_t now);
  Result thresholds(uint8_t start, uint8_t stop);
  void emergency(uint32_t now);
  Result reset(uint32_t now);
  bool ready(uint32_t now) const;
  uint16_t faults() const;
  uint8_t led() const;
  uint32_t remaining(uint32_t now) const;
  uint32_t cooldown(uint32_t now) const;
  Mode currentMode = Standby;
  bool valve = false;
  uint8_t startPercent, stopPercent;
 private:
  Policy policy_;
  bool cycle_ = false;
  int16_t temperature_ = -32768;
  Daylight daylight_ = DayUnknown;
  uint16_t latched_ = 0;
  RainState rainState_ = RainUnknown;
  bool haveRain_ = false;
  uint32_t rainAt_ = 0;
  bool haveSample_ = false, sampleValid_ = false, haveHeartbeat_ = false, haveClosed_ = false;
  uint8_t good_ = 0, bad_ = 0, moisture_ = 0;
  uint32_t sampledAt_ = 0, heartbeatAt_ = 0, openedAt_ = 0, closedAt_ = 0, duration_ = 0;
  bool configured() const;
  bool sensorReady(uint32_t now) const;
  bool rainReady(uint32_t now) const;
  void close(uint32_t now);
  void open(uint32_t now, uint32_t duration);
  void latch(uint16_t fault, uint32_t now);
};
const char *resultName(Result result);
}
