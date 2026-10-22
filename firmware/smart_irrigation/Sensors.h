#pragma once
#include <stdint.h>
#include "Controller.h"
namespace irrigation {
float estimatedLux(int raw, bool valid = true);
Daylight classifyDaylight(float lux, Daylight previous, uint16_t dayLux = 300, uint16_t nightLux = 200);
bool analogValid(int raw);
int16_t relativePercent(int raw, int zero, int hundred);
int16_t temperatureCenti(int raw, float referenceVolts, float celsiusPerVolt);
class RainSensor {
 public:
  RainSensor(bool configured, int dry, int wet, uint8_t start = 20, uint8_t clear = 10, uint32_t confirmMs = 60000)
    : configured_(configured), dry_(dry), wet_(wet), start_(start), clear_(clear), confirmMs_(confirmMs) {}
  void sample(int raw, uint32_t now);
  RainState state() const { return state_; }
  uint32_t remaining(uint32_t now) const;
 private:
  bool configured_, timing_ = false, sampled_ = false;
  int dry_, wet_;
  uint8_t start_, clear_;
  uint32_t confirmMs_, drySince_ = 0, sampledAt_ = 0;
  RainState state_ = RainUnknown;
};
}
