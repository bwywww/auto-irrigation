#include "Controller.h"
#include "Sensors.h"
#include "Protocol.h"
#include <iostream>
#include <string>
#include <cstring>
#include <cstdlib>
#include <limits>
using namespace irrigation;
int checks = 0;
#define CHECK(expression) do { ++checks; if (!(expression)) { std::cerr << "FAIL line " << __LINE__ << ": " #expression << '\n'; std::exit(1); } } while (false)
void healthy(Controller &c, uint32_t now, uint8_t soil = 20) {
  c.sample(true, soil, now - 2000); c.sample(true, soil, now - 1000); c.sample(true, soil, now);
}
Command command(uint32_t id, Operation operation, uint8_t a = 0, uint8_t b = 0) {
  Command c; c.id = id; c.operation = operation; c.a = a; c.b = b; return c;
}
bool parse(const std::string &text, Command &c) {
  char line[MAX_FRAME + 1]; std::strncpy(line, text.c_str(), MAX_FRAME); line[MAX_FRAME] = 0;
  return parseCommand(line, c);
}
int main() {
  {
    Controller c(Policy(true, true));
    c.environment(2500, Day); CHECK(c.pulseMs(30) == 5500);
    c.environment(2500, Night); CHECK(c.pulseMs(30) == 4500);
    c.environment(3000, Day); CHECK(c.pulseMs(20) == 10083);
    c.environment(3500, Day); CHECK(c.pulseMs(10) == 15400);
    c.environment(12500, Day); CHECK(c.pulseMs(10) == 15400);
    c.environment(-32768, DayUnknown); CHECK(c.pulseMs(30) == 5000);
    CHECK(c.pulseMs(44) == 2000); CHECK(c.pulseMs(45) == 0);
    CHECK(c.thresholds(44,45) == Ok); CHECK(c.pulseMs(0) == 20000);
    CHECK(classifyDaylight(300, DayUnknown) == Day);
    CHECK(classifyDaylight(200, Day) == Night);
    CHECK(classifyDaylight(250, Day) == Day); CHECK(classifyDaylight(250, Night) == Night);
    CHECK(classifyDaylight(250, DayUnknown) == DayUnknown); CHECK(classifyDaylight(-1, Day) == DayUnknown);
    CHECK(estimatedLux(650) == 175.7F); CHECK(estimatedLux(720) == 279.7F); CHECK(estimatedLux(1023) < 0);
  }
  {
    Controller c(Policy(true,true)); healthy(c,2000,30); c.environment(2500,Day); c.mode(Auto,2000);
    CHECK(c.plannedMs()==5500 && c.cycleActive());
    c.environment(3500,Day); // do not extend an active pulse
    for(uint32_t t=3000;t<=7000;t+=1000) { c.sample(true,35,t); c.tick(t); }
    c.sample(true,35,7500); c.tick(7500); CHECK(!c.valve && c.cycleActive());
    healthy(c,307499,35); c.tick(307499); CHECK(!c.valve);
    c.sample(true,35,307500); c.tick(307500); CHECK(c.valve && c.plannedMs()==4400);
    c.sample(true,45,308000); c.tick(308000); CHECK(!c.valve && !c.cycleActive());
    healthy(c,609000,35); c.tick(609000); CHECK(!c.valve);
    c.sample(true,30,610000); c.tick(610000); CHECK(c.valve);
    c.sample(false,0,610250); CHECK(!c.valve && !c.cycleActive());
    healthy(c,911000,35); c.tick(911000); CHECK(!c.valve);
    c.sample(true,30,912000); c.tick(912000); c.mode(Standby,912250); CHECK(!c.cycleActive());
    c.mode(Auto,912500); CHECK(c.cycleActive()); CHECK(c.thresholds(30,45)==Ok); CHECK(!c.cycleActive());
  }
  {
    Controller c(Policy(false, false)); healthy(c, 2000);
    CHECK(!c.valve && c.currentMode == Standby); CHECK(!c.ready(2000));
    CHECK(c.mode(Auto, 2000) == NotReady); CHECK(c.water(5, 2000) == NotReady);
  }
  {
    Controller c(Policy(true, true));
    c.sample(true, 20, 0); c.sample(true, 20, 1000); CHECK(!c.ready(1000));
    c.sample(true, 20, 2000); CHECK(c.ready(2000)); CHECK(!c.valve);
    CHECK(c.mode(Auto, 2000) == Ok); CHECK(c.valve);
    c.sample(true, 44, 3000); c.tick(3000); CHECK(c.valve);
    c.sample(true, 45, 4000); c.tick(4000); CHECK(!c.valve);
    healthy(c, 303999); c.tick(303999); CHECK(!c.valve);
    c.sample(true, 30, 304000); c.tick(304000); CHECK(c.valve);
    CHECK(c.thresholds(10, 50) == Busy);
  }
  {
    Controller c(Policy(true, true, 1000)); healthy(c, 2000); c.mode(Auto, 2000);
    for (uint32_t now = 3000; now <= 62000; now += 1000) { c.sample(true, now == 62000 ? 45 : 10, now); c.tick(now); }
    CHECK(!c.valve && (c.faults() & WaterTimeout));
    CHECK(c.mode(Auto, 62000) == Locked); CHECK(c.reset(62000) == Ok); CHECK(c.currentMode == Standby);
  }
  {
    Controller c(Policy(true, true)); healthy(c, 2000); c.mode(Manual, 2000);
    CHECK(c.water(5, 2000) == NeedHeartbeat); c.heartbeat(2000);
    CHECK(c.water(5, 2000) == Ok); CHECK(c.water(30, 2100) == Busy);
    for (uint32_t now = 3000; now <= 7000; now += 1000) { c.sample(true, 20, now); c.heartbeat(now); c.tick(now); }
    CHECK(!c.valve && c.faults() == 0); CHECK(c.currentMode == Manual);
    CHECK(c.water(0, 7000) == BadArgument); CHECK(c.water(31, 7000) == BadArgument);
    CHECK(c.water(30, 7000) == Ok);
    for (uint32_t now = 8000; now <= 12000; now += 1000) { c.sample(true, 20, now); c.tick(now); }
    CHECK(!c.valve && (c.faults() & LinkLost));
  }
  {
    Controller c(Policy(true, true)); healthy(c, 2000); c.mode(Auto, 2000);
    c.sample(false, 0, 3000); CHECK(!c.valve); CHECK(!(c.faults() & SoilFault));
    c.sample(false, 0, 4000); c.sample(false, 0, 5000); CHECK(c.faults() & SoilFault);
    c.sample(true, 20, 6000); CHECK(c.reset(6000) == NotReady);
    c.sample(true, 20, 7000); c.sample(true, 20, 8000); CHECK(!c.valve);
    CHECK(c.reset(8000) == Ok); CHECK(c.currentMode == Standby);
    c.mode(Auto, 8000); c.tick(11500); CHECK(c.faults() & SoilFault);
  }
  {
    Controller c(Policy(true, true)); healthy(c, 2000); c.mode(Auto, 2000); c.emergency(2500);
    CHECK(!c.valve && c.led() == 3); CHECK(c.mode(Manual, 2500) == Locked);
    CHECK(c.reset(2500) == Ok); CHECK(c.currentMode == Standby);
    CHECK(c.thresholds(45, 30) == BadArgument); CHECK(c.thresholds(0, 100) == Ok);
  }
  {
    Controller c(Policy(true, true)); uint32_t now = 0xfffffff0UL;
    healthy(c, now); c.heartbeat(now); c.mode(Manual, now); c.water(5, now);
    for (uint32_t elapsed = 1000; elapsed <= 5000; elapsed += 1000) {
      uint32_t t = now + elapsed; c.sample(true, 20, t); c.heartbeat(t); c.tick(t);
    }
    CHECK(!c.valve && !c.faults()); // millis wrap must not extend or instantly end watering
  }
  {
    Controller c(Policy(true, true)); Commands cmds; healthy(c, 2000); c.heartbeat(2000); c.mode(Manual, 2000);
    const Command water = command(123, Water, 5);
    CHECK(cmds.execute(water, c, 2000) == Ok);
    CHECK(cmds.execute(water, c, 4000) == Ok); CHECK(c.remaining(4000) == 3000);
    CHECK(cmds.execute(command(123, Water, 30), c, 4000) == IdConflict);
    for (uint32_t now = 3000; now <= 7000; now += 1000) { c.sample(true, 20, now); c.heartbeat(now); c.tick(now); }
    CHECK(!c.valve); CHECK(cmds.execute(water, c, 7100) == Ok); CHECK(!c.valve);
    CHECK(cmds.execute(command(124, Stop), c, 7100) == Ok); CHECK(c.faults() & Emergency);
  }
  {
    Command c;
    CHECK(parse("C,1,4294967295,WATER,5", c)); CHECK(c.id == UINT32_MAX && c.a == 5);
    CHECK(!parse("C,1,4294967296,STOP", c)); CHECK(!parse("C,1,1,WATER,5junk", c));
    CHECK(!parse("C,1,1,WATER,-1", c)); CHECK(!parse("C,2,1,STOP", c));
    CHECK(!parse("C,1,1,,STOP", c)); CHECK(!parse("C,1,1,STOP,", c));
    CHECK(!parse("C,1,0,STOP", c)); CHECK(!parse("C,1,1,HB", c)); CHECK(parse("C,1,0,HB", c));
    LineReader reader; int lines = 0;
    for (char ch : std::string("C,1,1,STOP\r\nC,1,2,STATUS\n")) if (reader.feed(ch)) ++lines;
    CHECK(lines == 2);
    for (char ch : std::string(250, 'x') + "C,1,3,STOP\n") CHECK(!reader.feed(ch));
    for (char ch : std::string("C,1,4,STOP\n")) if (reader.feed(ch)) { CHECK(parseCommand(reader.line(), c)); ++lines; }
    CHECK(lines == 3);
    for (char ch : std::string("C,1,5,WA\rTER,5\n")) CHECK(!reader.feed(ch));
    for (char ch : std::string("C,1,6,STATUS\r\n")) if (reader.feed(ch)) ++lines;
    CHECK(lines == 4);
  }
  CHECK(relativePercent(820, 820, 350) == 0); CHECK(relativePercent(350, 820, 350) == 100);
  CHECK(relativePercent(500, 100, 900) == 50); CHECK(relativePercent(1, 5, 5) == -1);
  CHECK(relativePercent(700, 700, 400) == 0);
  CHECK(relativePercent(400, 700, 400) == 100);
  CHECK(relativePercent(550, 700, 400) == 50);
  CHECK(relativePercent(669, 700, 400) == 10);
  CHECK(relativePercent(800, 700, 400) == 0);
  CHECK(relativePercent(300, 700, 400) == 100);
  CHECK(temperatureCenti(0, 5, 100) == 0);
  CHECK(temperatureCenti(51, 5, 100) == 2493);
  CHECK(temperatureCenti(64, 5, 100) == 3128); // reference ADC
  CHECK(temperatureCenti(100, 5, 100) == 4888);
  CHECK(temperatureCenti(64, 4.9F, 100) == 3065);
  CHECK(temperatureCenti(255, 5, 100) == 12463);
  CHECK(temperatureCenti(256, 5, 100) == -32768); // above V1's 125 C limit
  CHECK(temperatureCenti(1023, 5, 100) == -32768); // no int16 overflow
  CHECK(temperatureCenti(-1, 5, 100) == -32768);
  CHECK(temperatureCenti(1024, 5, 100) == -32768);
  CHECK(temperatureCenti(64, 0, 100) == -32768);
  CHECK(temperatureCenti(64, 5, -1) == -32768);
  CHECK(temperatureCenti(64, std::numeric_limits<float>::quiet_NaN(), 100) == -32768);
  CHECK(temperatureCenti(64, 5, std::numeric_limits<float>::infinity()) == -32768);
  {
    // Field calibration: ADC zero is valid dry; 400..1023 is wet, not a sensor fault.
    RainSensor field(true, 0, 400);
    for (uint32_t t = 0; t <= 60000; t += 250) field.sample(0, t);
    CHECK(field.state() == RainDry);
    field.sample(79, 60250); CHECK(field.state() == RainDry);
    field.sample(80, 60500); CHECK(field.state() == RainWet);
    field.sample(400, 60750); CHECK(field.state() == RainWet);
    field.sample(600, 61000); CHECK(field.state() == RainWet);
    field.sample(1023, 61250); CHECK(field.state() == RainWet);
    field.sample(0, 61500); CHECK(field.state() == RainDrying);
    field.sample(44, 61750); CHECK(field.remaining(61750) == 60000);
    for (uint32_t t = 62000; t < 122000; t += 250) field.sample(43, t);
    CHECK(field.state() == RainDrying);
    field.sample(43, 122000); CHECK(field.state() == RainDry);
    RainSensor unconfigured(false, 900, 300);
    unconfigured.sample(900, 0); CHECK(unconfigured.state() == RainUnknown);
    RainSensor r(true, 900, 300);
    for (uint32_t now = 0; now < 60000; now += 1000) { r.sample(900, now); CHECK(r.state() == RainDrying); }
    r.sample(900, 60000); CHECK(r.state() == RainDry);
    r.sample(810, 60250); CHECK(r.state() == RainDry); // hysteresis 15%
    r.sample(780, 60500); CHECK(r.state() == RainWet); // wet at 20%
    r.sample(840, 60750); CHECK(r.state() == RainDrying); CHECK(r.remaining(60750) == 60000);
    r.sample(830, 61000); CHECK(r.remaining(61000) == 60000); // interrupted dry confirmation
    for (uint32_t now = 61250; now <= 121250; now += 1000) r.sample(900, now);
    CHECK(r.state() == RainDry);
    r.sample(900, 125000); CHECK(r.state() == RainDrying); // missing samples restart confirmation
    r.sample(-1, 125250); CHECK(r.state() == RainInvalid);
    r.sample(0, 125500); CHECK(r.state() == RainWet); // fully wet rail is legitimate
    RainSensor reverse(true, 300, 900);
    reverse.sample(900, 0); CHECK(reverse.state() == RainWet);
    const uint32_t start = 0xfffff000UL;
    for (uint32_t elapsed = 0; elapsed <= 60000; elapsed += 1000) reverse.sample(300, start + elapsed);
    CHECK(reverse.state() == RainDry); // rollover
    RainSensor invalid(true, 900, 900);
    invalid.sample(900, 0); CHECK(invalid.state() == RainInvalid);
  }
  {
    Controller c(Policy(true, true, 60000, 300000, 5000, 3500, 30, 45, true));
    healthy(c, 2000); CHECK(!c.ready(2000)); CHECK(c.mode(Manual, 2000) == NotReady);
    c.rain(RainDry, 2000); CHECK(c.mode(Manual, 2000) == Ok); c.heartbeat(2000);
    Commands cmds; const Command water = command(900, Water, 30);
    CHECK(cmds.execute(water, c, 2000) == Ok); CHECK(c.valve);
    c.rain(RainWet, 2250); CHECK(!c.valve); CHECK(c.currentMode == Manual);
    CHECK(c.faults() & RainBlocked); CHECK(c.water(5, 2250) == NotReady);
    CHECK(c.reset(2250) == NotReady);
    c.rain(RainDrying, 2500); CHECK(!c.ready(2500));
    c.rain(RainDry, 3000); healthy(c, 3000);
    CHECK(cmds.execute(water, c, 3000) == Ok); CHECK(!c.valve); // retry never resumes old watering
    CHECK(c.mode(Auto, 3000) == Ok); CHECK(!c.valve); // cooling after rain closure
    healthy(c, 302250); c.rain(RainDry, 302250); c.tick(302250); CHECK(c.valve);
    c.rain(RainInvalid, 302500); CHECK(!c.valve); CHECK(c.faults() & RainFault);
    c.rain(RainDry, 303000); healthy(c, 306500); c.tick(306500);
    CHECK(c.faults() & RainFault); CHECK(!c.ready(306500)); // rain sample stale, soil still fresh
    c.rain(RainDry, 306500); c.emergency(306500);
    CHECK(c.faults() & Emergency); CHECK(c.reset(306500) == Ok);
    CHECK(c.currentMode == Standby && !c.valve);
  }
  {
    Controller c(Policy(true, true)); healthy(c, 2000); c.mode(Auto, 2000);
    unsigned starts = 1; bool old = c.valve;
    for (uint32_t now = 3000; now <= 86402000; now += 1000) {
      c.sample(true, c.valve ? 50 : 20, now); c.tick(now);
      CHECK(!c.faults()); if (c.valve && !old) ++starts; old = c.valve;
    }
    CHECK(starts > 200 && starts < 300); // accelerated 24h logic simulation, not a hardware soak
  }
  std::cout << "PASS " << checks << " controller / sensor / protocol checks (includes accelerated 24h simulation)\n";
}
