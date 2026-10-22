// Run the actual sketch loop with serial/pin/time substitutes, not a copy of it.
#include "../firmware/smart_irrigation/smart_irrigation.ino"
#include <iostream>
#include <cstdlib>

uint64_t testMicros = 0;
int testRainRaw = 0;
uint8_t testPins[20] = {};
HardwareSerial Serial;
#define CHECK(expression) do { if (!(expression)) { std::cerr << "FAIL line " << __LINE__ << ": " #expression << '\n'; std::exit(1); } } while (false)
void runFor(uint32_t duration) {
  const uint64_t end = testMicros + duration;
  while (testMicros < end) { loop(); testMicros += 250; }
}
size_t frames(const std::string &text, const std::string &prefix) {
  size_t count = 0, at = 0;
  while ((at = text.find(prefix, at)) != std::string::npos) { ++count; at += prefix.size(); }
  return count;
}
int main() {
  setup();
  CHECK(bluetooth.availableForWrite() == 0);
  runFor(3200000);
  CHECK(frames(Serial.outgoing, "D,3,") >= 4);
  CHECK(Serial.outgoing == bluetooth.outgoing);
  CHECK(tempRaw == 64 && tempCenti == 3128);
  CHECK(soilRaw == 669 && soilPercent == 10);
  CHECK(validMask == 3 && !(environmentFaults & TemperatureFault));
  CHECK(Serial.outgoing.find(",669,10,64,3128,789,-1,3,") != std::string::npos);
  CHECK(!controller.ready(millis())); // rain is confirming initial dryness
  CHECK(!controller.valve);
  Serial.inject("C,1,101,STATUS\n");
  runFor(300000);
  CHECK(Serial.outgoing.find("A,1,101,OK\n") != std::string::npos);
  CHECK(Serial.outgoing == bluetooth.outgoing);
  bluetooth.inject("C,1,102,STATUS\r\n");
  runFor(300000);
  CHECK(bluetooth.outgoing.find("A,1,102,OK\n") != std::string::npos);
  CHECK(Serial.outgoing == bluetooth.outgoing);

  // Fixed ADC input must not change when relay/LED outputs change. Enable only
  // the test controller so this regression also runs with production gates off.
  controller = Controller(Policy(true, true));
  runFor(3200000);
  CHECK(controller.ready(millis()));
  Serial.inject("C,1,104,MODE,2\nC,1,0,HB\nC,1,105,WATER,2\n");
  runFor(300000);
  CHECK(controller.valve);
  CHECK(testPins[VALVE_PIN] == (RELAY_ACTIVE_LOW ? LOW : HIGH));
  runFor(1200000); // includes a fresh sample while the output is on
  CHECK(controller.valve && soilRaw == 669 && soilPercent == 10);
  CHECK(tempRaw == 64 && lightRaw == 789);
  runFor(1000000);
  CHECK(!controller.valve && soilRaw == 669 && soilPercent == 10);
  CHECK(testPins[VALVE_PIN] == (RELAY_ACTIVE_LOW ? HIGH : LOW));
  CHECK(controller.cooldown(millis()) > 0);
  CHECK(controller.mode(Auto, millis()) == Ok);
  runFor(1200000);
  CHECK(!controller.valve && soilRaw == 669 && soilPercent == 10);

  // STOP is processed while a telemetry frame is still being drained.
  telemetryDue = true;
  loop();
  CHECK(bleAt < txSize);
  bluetooth.inject("C,1,103,STOP\n");
  runFor(1000);
  CHECK(controller.faults() & Emergency);
  CHECK(testPins[VALVE_PIN] == (RELAY_ACTIVE_LOW ? HIGH : LOW));
  runFor(300000);
  CHECK(bluetooth.outgoing.find("A,1,103,OK\n") != std::string::npos);

  // Exercise the real A3 acquisition and controller path, with no browser heartbeat.
  controller = Controller(Policy(true, true, 60000, 300000, 5000, 3500, 30, 45, true));
  rainSensor = RainSensor(RAIN_CONFIGURED, RAIN_DRY_RAW, RAIN_WET_RAW, RAIN_START_PERCENT, RAIN_CLEAR_PERCENT, RAIN_DRY_CONFIRM_MS);
  testRainRaw = 0;
  runFor(61000000);
  CHECK(controller.rainState() == RainDry && controller.ready(millis()));
  CHECK(controller.mode(Auto, millis()) == Ok); CHECK(controller.valve);
  testRainRaw = 600;
  runFor(250000);
  CHECK(!controller.valve && controller.rainState() == RainWet);
  CHECK(controller.faults() & RainBlocked);
  CHECK(testPins[VALVE_PIN] == (RELAY_ACTIVE_LOW ? HIGH : LOW));
  CHECK(controller.mode(Manual, millis()) == NotReady);
  testRainRaw = 0;
  runFor(59000000); CHECK(!controller.ready(millis()));
  runFor(2000000); CHECK(controller.rainState() == RainDry);
  CHECK(!controller.valve); // automatic cooling still applies

  // Exercise micros() rollover in the real transmit path.
  testMicros = uint64_t(UINT32_MAX) - 10000;
  const size_t before = frames(bluetooth.outgoing, "D,3,");
  runFor(1300000);
  CHECK(frames(bluetooth.outgoing, "D,3,") >= before + 2);
  CHECK(Serial.outgoing == bluetooth.outgoing);
  std::cout << "Sketch serial-loop tests passed: continuous USB/BLE data, both command inputs, fixed ADC during relay transitions and cooldown, STOP during TX, micros rollover.\n";
}
