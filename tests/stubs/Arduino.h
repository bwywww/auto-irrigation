#pragma once
#include <stdint.h>
#include <stddef.h>
#include <deque>
#include <string>

constexpr uint8_t A0 = 14, A1 = 15, A2 = 16, A3 = 17;
extern int testRainRaw;
constexpr uint8_t LOW = 0, HIGH = 1, INPUT = 0, OUTPUT = 1;
extern uint64_t testMicros;
extern uint8_t testPins[20];
inline uint32_t micros() { return uint32_t(testMicros); }
inline uint32_t millis() { return uint32_t(testMicros / 1000); }
inline void digitalWrite(uint8_t pin, uint8_t value) { testPins[pin] = value; }
inline void pinMode(uint8_t, uint8_t) {}
inline int analogRead(uint8_t pin) { return pin == A0 ? 669 : pin == A1 ? 789 : pin == A3 ? testRainRaw : 64; }

class Stream {
 public:
  std::deque<char> incoming;
  std::string outgoing;
  virtual ~Stream() {}
  int available() { return int(incoming.size()); }
  int read() { char c = incoming.front(); incoming.pop_front(); return c; }
  // Arduino Print's default. AltSoftSerial 1.4.0 does not override it.
  virtual int availableForWrite() { return 0; }
  virtual size_t write(uint8_t value) { outgoing += char(value); return 1; }
  void inject(const std::string &line) { for (char c : line) incoming.push_back(c); }
};
class HardwareSerial : public Stream {
 public:
  void begin(uint32_t) {}
  int availableForWrite() override { return 63; }
};
extern HardwareSerial Serial;
