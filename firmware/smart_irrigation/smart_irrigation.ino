#include <Arduino.h>
#include <AltSoftSerial.h>
#include <avr/pgmspace.h>
#include "Config.h"
#include "Controller.h"
#include "Sensors.h"
#include "Protocol.h"

using namespace irrigation;
Policy policy = {ACTUATOR_VERIFIED, SOIL_CALIBRATED && SOIL_DRY_RAW != SOIL_WET_RAW &&
                 SOIL_DRY_RAW >= 0 && SOIL_DRY_RAW <= 1023 && SOIL_WET_RAW >= 0 && SOIL_WET_RAW <= 1023,
                 MAX_WATER_MS, COOLDOWN_MS, HEARTBEAT_TIMEOUT_MS, SENSOR_STALE_MS,
                 START_PERCENT, STOP_PERCENT, true};
Policy configuredPolicy() {
  policy.algorithm.baseMs = AUTO_BASE_MS; policy.algorithm.minMs = AUTO_MIN_MS; policy.algorithm.maxMs = AUTO_MAX_MS;
  policy.algorithm.referenceC = AUTO_REFERENCE_C; policy.algorithm.temperatureSlope = AUTO_TEMP_SLOPE;
  policy.algorithm.minTemperature = AUTO_TEMP_MIN; policy.algorithm.maxTemperature = AUTO_TEMP_MAX;
  policy.algorithm.dayFactor = AUTO_DAY_FACTOR; policy.algorithm.nightFactor = AUTO_NIGHT_FACTOR;
  return policy;
}
Controller controller(configuredPolicy());
Daylight lightPeriod = DayUnknown;
RainSensor rainSensor(RAIN_CONFIGURED, RAIN_DRY_RAW, RAIN_WET_RAW, RAIN_START_PERCENT, RAIN_CLEAR_PERCENT, RAIN_DRY_CONFIRM_MS);
Commands commands;
AltSoftSerial bluetooth;
LineReader bleInput, usbInput;
int soilRaw = 0, lightRaw = 0, tempRaw = 0;
int rainRaw = 0;
uint32_t lastRainSample = 0;
bool rainSampled = false;
int16_t soilPercent = -1, lightPercent = -1, tempCenti = -32768;
uint8_t validMask = 0;
uint16_t environmentFaults = 0;
uint32_t sequence = 0, lastSample = 0;
bool sampled = false, telemetryDue = true;

// One shared outgoing frame is drained independently into both serial ports.
// ACKs take precedence over the next telemetry frame. No delay()/blocking prints.
char tx[MAX_FRAME + 1];
uint8_t txSize = 0, bleAt = 0, usbAt = 0;
// AltSoftSerial 1.4.0 inherits Print::availableForWrite(), which always returns 0.
// Pace one byte per 12 bit-times (8N1 needs 10) to keep its TX buffer from filling.
// No catch-up bursts: receive(), safety timers and outputs run between bytes.
constexpr uint32_t BLE_BYTE_INTERVAL_US = (12000000UL + BLUETOOTH_BAUD - 1) / BLUETOOTH_BAUD;
uint32_t lastBleWriteUs = 0;
struct PendingAck { uint32_t id; Result result; };
PendingAck acknowledgements[4];
uint8_t ackHead = 0, ackCount = 0;

void outputs(uint32_t now) {
  digitalWrite(VALVE_PIN, controller.valve ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  uint8_t state = environmentFaults ? 3 : controller.led();
  bool on = state == 2 || (state == 1 && now % 2000 < 250) || (state == 3 && now % 400 < 200);
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
int average(uint8_t pin) {
  analogRead(pin); // discard first conversion after multiplexer switch
  uint16_t total = 0;
  for (uint8_t i = 0; i < 8; ++i) total += analogRead(pin);
  return total / 8;
}
void sampleSensors(uint32_t now) {
  soilRaw = average(SOIL_PIN); lightRaw = average(LIGHT_PIN); tempRaw = average(TEMP_PIN);
  soilPercent = SOIL_CALIBRATED && analogValid(soilRaw) ? relativePercent(soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW) : -1;
  lightPercent = LIGHT_CALIBRATED && analogValid(lightRaw) ? relativePercent(lightRaw, LIGHT_DARK_RAW, LIGHT_BRIGHT_RAW) : -1;
  tempCenti = temperatureCenti(tempRaw, TEMP_REFERENCE_VOLTS, TEMP_C_PER_VOLT);
  validMask = (soilPercent >= 0 ? 1 : 0) | (tempCenti != -32768 ? 2 : 0) | (lightPercent >= 0 ? 4 : 0);
  environmentFaults = (!analogValid(lightRaw) ? uint16_t(LightFault) : 0) |
                      (tempCenti == -32768 ? uint16_t(TemperatureFault) : 0);
  lightPeriod = classifyDaylight(estimatedLux(lightRaw, !(environmentFaults & LightFault)), lightPeriod, DAY_LUX, NIGHT_LUX);
  controller.environment(tempCenti, lightPeriod);
  // An uncalibrated but electrically healthy probe is not a disconnect fault.
  controller.sample(analogValid(soilRaw), soilPercent >= 0 ? uint8_t(soilPercent) : 0, now);
  telemetryDue = true;
}
void receive(Stream &port, LineReader &reader) {
  // Bound work per loop to keep safety timers and output writes responsive under flooding.
  for (uint8_t i = 0; i < 32 && port.available(); ++i) {
    if (!reader.feed(char(port.read()))) continue;
    Command command;
    if (!parseCommand(reader.line(), command)) continue;
    if (command.operation == Heartbeat) { commands.execute(command, controller, millis()); continue; }
    // Never perform an ordinary command unless its response can be queued.
    if (ackCount == 4 && command.operation != Stop) continue;
    const Result result = commands.execute(command, controller, millis());
    outputs(millis());
    if (ackCount < 4) {
      const uint8_t slot = (ackHead + ackCount) % 4;
      acknowledgements[slot] = {command.id, result}; ++ackCount;
    }
    telemetryDue = true;
  }
}
void transmit(uint32_t now) {
  if (bleAt == txSize && usbAt == txSize) {
    int length = 0;
    if (ackCount) {
      const PendingAck &ack = acknowledgements[ackHead];
      length = snprintf_P(tx, sizeof(tx), PSTR("A,1,%lu,%s\n"), (unsigned long)ack.id, resultName(ack.result));
      ackHead = (ackHead + 1) % 4; --ackCount;
    } else if (telemetryDue && sampled) {
      length = snprintf_P(tx, sizeof(tx),
        PSTR("D,3,%lu,%lu,%d,%d,%d,%d,%d,%d,%u,%u,%u,%u,%u,%u,%u,%u,%lu,%lu,%d,%u,%lu,%u,%lu,%u\n"),
        (unsigned long)sequence++, (unsigned long)now, soilRaw, soilPercent, tempRaw, tempCenti,
        lightRaw, lightPercent, unsigned(validMask), unsigned(controller.currentMode), unsigned(controller.valve),
        unsigned(environmentFaults ? 3 : controller.led()), unsigned(controller.faults() | environmentFaults),
        unsigned(controller.startPercent), unsigned(controller.stopPercent), unsigned(controller.ready(now)),
        (unsigned long)controller.remaining(now), (unsigned long)controller.cooldown(now), rainRaw,
        unsigned(controller.rainState()), (unsigned long)(controller.rainState() == RainDrying ? rainSensor.remaining(now) : 0),
        unsigned(lightPeriod), (unsigned long)controller.plannedMs(), unsigned(controller.cycleActive()));
      telemetryDue = false;
    }
    txSize = length > 0 && length <= int(MAX_FRAME) ? uint8_t(length) : 0;
    bleAt = usbAt = 0;
  }
  if (bleAt < txSize && uint32_t(micros() - lastBleWriteUs) >= BLE_BYTE_INTERVAL_US) {
    bluetooth.write(uint8_t(tx[bleAt++]));
    lastBleWriteUs = micros();
  }
  while (usbAt < txSize && Serial.availableForWrite() > 0) Serial.write(uint8_t(tx[usbAt++]));
}
void setup() {
  digitalWrite(VALVE_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW); pinMode(VALVE_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW); pinMode(LED_PIN, OUTPUT);
  pinMode(SOIL_PIN, INPUT); pinMode(LIGHT_PIN, INPUT); pinMode(TEMP_PIN, INPUT); pinMode(RAIN_PIN, INPUT);
  Serial.begin(DEBUG_BAUD); bluetooth.begin(BLUETOOTH_BAUD);
}
void loop() {
  uint32_t now = millis();
  if (!rainSampled || uint32_t(now - lastRainSample) >= RAIN_SAMPLE_MS) {
    lastRainSample = now; rainSampled = true;
    rainRaw = average(RAIN_PIN);
    const RainState previousRain = rainSensor.state();
    rainSensor.sample(rainRaw, now);
    controller.rain(rainSensor.state(), now);
    if (previousRain != rainSensor.state()) telemetryDue = true;
  }
  controller.tick(now); outputs(now);
  receive(bluetooth, bleInput); receive(Serial, usbInput);
  now = millis();
  if (!sampled || uint32_t(now - lastSample) >= SAMPLE_MS) {
    lastSample = now; sampleSensors(now); sampled = true;
  }
  controller.tick(millis()); outputs(millis()); transmit(millis());
}
