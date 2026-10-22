import { describe, it, expect } from "vitest";
import { encodeCommand, encodeTelemetry, FrameDecoder, parseFrame, type Telemetry } from "./protocol";
const data = "D,1,42,5000,651,36,490,2640,650,67,7,0,0,0,0,30,45,1,0,0";
describe("wire protocol", () => {
  it("reads V2 rain states and keeps old V1 history explicitly without rain data", () => {
    const legacy = parseFrame(data) as Telemetry;
    expect(legacy.rain).toBeUndefined();
    const dry = { ...legacy, rain: { raw: 900, state: 1 as const, remaining: 0 } };
    const wire = encodeTelemetry(dry);
    expect(wire.startsWith("D,2,")).toBe(true);
    expect(parseFrame(wire.trim())).toEqual(dry);
    for (const state of [0, 2, 3, 4] as const) {
      const faults = state === 0 ? 64 : state === 4 ? 256 : 128;
      const rain = { raw: 300, state, remaining: state === 3 ? 60000 : 0 };
      expect(parseFrame(encodeTelemetry({ ...legacy, ready: false, faults, rain }).trim()))
        .toMatchObject({ rain, ready: false, faults });
    }
    const bytes = new TextEncoder().encode(wire + "A,1,9,OK\n");
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = new FrameDecoder();
      expect([...decoder.feed(bytes.slice(0, split)), ...decoder.feed(bytes.slice(split))]).toHaveLength(2);
    }
  });
  it("rejects rain bypasses, inconsistent rain faults and invalid rain fields", () => {
    const legacy = parseFrame(data) as Telemetry;
    const wet = { ...legacy, faults: 128, ready: false, rain: { raw: 300, state: 2 as const, remaining: 0 } };
    for (const invalid of [
      { ...wet, ready: true }, { ...wet, valve: true, mode: 2 as const },
      { ...wet, faults: 0 }, { ...wet, rain: { ...wet.rain, raw: 1024 } },
      { ...wet, rain: { ...wet.rain, remaining: 100 } },
    ]) expect(parseFrame(encodeTelemetry(invalid).trim())).toBeNull();
    const largest = encodeTelemetry({ ...wet, seq: 0xffffffff, uptime: 0xffffffff, rain: { raw: 1023, state: 3, remaining: 60000 }, cooldown: 300000 });
    expect(largest.length).toBeLessThanOrEqual(192);
    expect(parseFrame(largest.trim())).not.toBeNull();
  });
  it("decodes integers, validity and temperature units", () => {
    expect(parseFrame(data)).toMatchObject({
      seq: 42,
      temperature: 26.4,
      soil: 36,
      ready: true,
      valve: false,
    });
    expect(
      parseFrame("D,1,1,0,0,-1,0,-32768,0,-1,0,0,0,3,112,30,45,0,0,0"),
    ).toMatchObject({ soil: null, temperature: null });
    // Real sketch output using the linear formula: ADC 64 -> 31.28 C.
    expect(
      parseFrame("D,1,7,6099,684,-1,64,3128,720,-1,2,0,0,3,64,30,45,0,0,0"),
    ).toMatchObject({ temperature: 31.28, soil: null, light: null });
  });
  it("accepts every possible fragmentation boundary and concatenated frames", () => {
    const bytes = new TextEncoder().encode(data + "\r\nA,1,9,OK\n");
    for (let split = 0; split <= bytes.length; split++) {
      const d = new FrameDecoder();
      expect([
        ...d.feed(bytes.slice(0, split)),
        ...d.feed(bytes.slice(split)),
      ]).toHaveLength(2);
    }
  });
  it("rejects malformed and inconsistent sensor data", () => {
    for (const invalid of [
      data.replace("D,1", "D,2"),
      data + ",extra",
      data.replace(",2640,", ",NaN,"),
      data.replace(",2640,", ",-32768,"),
      data.replace(",651,", ",2000,"),
      data.replace(",0,0,0,0,30", ",0,1,0,0,30"),
    ])
      expect(parseFrame(invalid)).toBeNull();
  });
  it("recovers from overlong and non-ASCII frames only at a newline", () => {
    const d = new FrameDecoder();
    expect(
      d.feed(new TextEncoder().encode("x".repeat(300) + data + "\n")),
    ).toHaveLength(0);
    expect(
      d.feed(new TextEncoder().encode("\0" + data + "\n" + data + "\n")),
    ).toHaveLength(1);
    expect(d.rejected).toBe(2);
  });
  it("never turns invalid input into a control command", () => {
    expect(encodeCommand(1, "THRESH", [30, 45])).toBe("C,1,1,THRESH,30,45\n");
    for (const args of [
      [45, 30],
      [0, 101],
      [NaN, 45],
      [30.5, 45],
    ])
      expect(() => encodeCommand(1, "THRESH", args)).toThrow();
    expect(() => encodeCommand(1, "WATER", [31])).toThrow();
    expect(() => encodeCommand(0, "STOP")).toThrow();
  });
  it("rejects embedded carriage returns instead of silently joining tokens", () => {
    const decoder = new FrameDecoder();
    expect(
      decoder.feed(new TextEncoder().encode("A,1,9,O\rK\nA,1,10,OK\r\n")),
    ).toEqual([{ kind: "ack", id: 10, result: "OK" }]);
  });
});

it("roundtrips V3 pulses and rejects inconsistent control fields", () => {
  const legacy = parseFrame(data) as Telemetry;
  const t: Telemetry = { ...legacy, mode: 1, valve: true, remaining: 5500,
    rain: {raw:0,state:1,remaining:0}, algorithm: {daylight:1,planned:5500,active:true} };
  const wire = encodeTelemetry(t);
  expect(wire.startsWith("D,3,")).toBe(true);
  expect(parseFrame(wire.trim())).toEqual(t);
  for(let cut=0;cut<wire.length;cut++) {
    const d = new FrameDecoder(); const bytes = new TextEncoder().encode(wire);
    expect([...d.feed(bytes.slice(0,cut)),...d.feed(bytes.slice(cut))]).toEqual([t]);
  }
  for(const algorithm of [{daylight:3,planned:5500,active:true},{daylight:1,planned:20001,active:true},
    {daylight:1,planned:5500,active:false},{daylight:1,planned:2000,active:true}])
    expect(parseFrame(encodeTelemetry({...t,algorithm} as Telemetry).trim())).toBeNull();
  expect(parseFrame(encodeTelemetry({...t,seq:0xffffffff,uptime:0xffffffff,soilRaw:1023,tempRaw:1023,lightRaw:1023}).trim())).not.toBeNull();
  expect(encodeTelemetry({...t,seq:0xffffffff,uptime:0xffffffff}).length).toBeLessThanOrEqual(192);
  expect((parseFrame(data) as Telemetry).algorithm).toBeUndefined();
});
