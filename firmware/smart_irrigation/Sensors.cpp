#include "Sensors.h"
#include <math.h>
namespace irrigation {
void RainSensor::sample(int raw, uint32_t now) {
  if (sampled_ && uint32_t(now - sampledAt_) >= 3500) { state_ = RainInvalid; timing_ = false; }
  sampled_ = true; sampledAt_ = now;
  if (!configured_) { state_ = RainUnknown; timing_ = false; return; }
  if (raw < 0 || raw > 1023 || dry_ < 0 || wet_ < 0 || dry_ > 1023 || wet_ > 1023 ||
      dry_ == wet_ || clear_ >= start_ || start_ > 100 || confirmMs_ == 0 || confirmMs_ > 60000) {
    state_ = RainInvalid; timing_ = false; return;
  }
  const int16_t wetness = relativePercent(raw, dry_, wet_);
  if (wetness >= start_) { state_ = RainWet; timing_ = false; return; }
  if (state_ == RainDry) return; // hysteresis: only the wet threshold can revoke clear status
  if (wetness > clear_) { timing_ = false; if (state_ != RainWet) state_ = RainDrying; return; }
  if (!timing_) { timing_ = true; drySince_ = now; }
  state_ = uint32_t(now - drySince_) >= confirmMs_ ? RainDry : RainDrying;
}
uint32_t RainSensor::remaining(uint32_t now) const {
  if (state_ != RainDrying) return 0;
  const uint32_t elapsed = uint32_t(now - drySince_);
  return !timing_ ? confirmMs_ : elapsed >= confirmMs_ ? 0 : confirmMs_ - elapsed;
}
float estimatedLux(int raw, bool valid) {
  if (!valid || raw < 0 || raw >= 1023) return -1;
  const float value = powf(18.0F * raw / (1023 - raw), 1.5F);
  return floorf(value * 10.0F + 0.5F) / 10.0F;
}
Daylight classifyDaylight(float lux, Daylight previous, uint16_t dayLux, uint16_t nightLux) {
  if (!isfinite(lux) || lux < 0) return DayUnknown;
  if (lux >= dayLux) return Day;
  if (lux <= nightLux) return Night;
  return previous;
}
bool analogValid(int raw) { return raw > 5 && raw < 1018; }
int16_t relativePercent(int raw, int zero, int hundred) {
  if (zero == hundred || zero < 0 || zero > 1023 || hundred < 0 || hundred > 1023) return -1;
  long value = (long(raw) - zero) * 100L / (hundred - zero);
  return value < 0 ? 0 : value > 100 ? 100 : int16_t(value);
}
int16_t temperatureCenti(int raw, float referenceVolts, float celsiusPerVolt) {
  if (raw < 0 || raw > 1023 || !isfinite(referenceVolts) || !isfinite(celsiusPerVolt) ||
      referenceVolts <= 0 || celsiusPerVolt <= 0) return -32768;
  const float celsius = float(raw) * (referenceVolts / 1023.0F * celsiusPerVolt);
  // Preserve V1's upper temperature limit; reject before casting to int16_t.
  // This linear formula produces non-negative values, including 0 ADC -> 0 C.
  if (!isfinite(celsius) || celsius < 0 || celsius > 125) return -32768;
  return int16_t(lroundf(celsius * 100.0F));
}
}
