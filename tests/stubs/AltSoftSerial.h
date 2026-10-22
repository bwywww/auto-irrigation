#pragma once
#include "Arduino.h"
#include <stdexcept>
class AltSoftSerial : public Stream {
 public:
  uint32_t baud = 0, lastWrite = 0;
  bool wrote = false;
  void begin(uint32_t value) { baud = value; }
  size_t write(uint8_t value) override {
    // Assert the sketch never fills the library buffer by sending too fast.
    if (wrote && uint32_t(micros() - lastWrite) < (10000000UL + baud - 1) / baud)
      throw std::runtime_error("BLE writes exceed 8N1 wire rate");
    lastWrite = micros(); wrote = true;
    return Stream::write(value);
  }
};
