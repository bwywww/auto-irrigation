import { expect, it } from "vitest";
import { estimatedLux } from "./measurements";
import { samplesCsv, type Sample } from "./storage";
import { parseFrame, type Telemetry } from "./protocol";

it("converts light ADC using the supplied approximate lux formula", () => {
  expect(estimatedLux({ lightRaw: 512, faults: 0 })).toBe(76.6);
  expect(estimatedLux({ lightRaw: 650, faults: 0 })).toBe(175.7);
  expect(estimatedLux({ lightRaw: 720, faults: 0 })).toBe(279.7);
  expect(estimatedLux({ lightRaw: 1017, faults: 0 })).toBe(168524.6);
});
it("handles darkness, saturation, invalid ADC and light faults without infinity", () => {
  expect(estimatedLux({ lightRaw: 0, faults: 0 })).toBe(0);
  for (const lightRaw of [1023, 1024, -1, NaN, Infinity, 2.5])
    expect(estimatedLux({ lightRaw, faults: 0 })).toBeNull();
  expect(estimatedLux({ lightRaw: 650, faults: 32 })).toBeNull();
  expect(estimatedLux({ lightRaw: 650, faults: 64 })).toBe(175.7);
});
it("exports estimated lux from legacy raw data without changing stored percentages", () => {
  const data = parseFrame("D,1,42,5000,651,36,64,3128,650,67,7,0,0,0,0,30,45,1,0,0") as Telemetry;
  const sample: Sample = { source: "real", session: "old", device: "HC-08", receivedAt: 1000, data };
  const csv = samplesCsv([sample]);
  expect(csv.split("\r\n")[0]).toContain('"估算照度lux"');
  expect(csv.split("\r\n")[1]).toMatch(/,"175.7","","","","","",""$/);
  expect(data.light).toBe(67);
  const invalid = samplesCsv([{ ...sample, data: { ...data, faults: 32 } }]);
  expect(invalid.split("\r\n")[1]).toMatch(/,""$/);
  const rainy = samplesCsv([{ ...sample, data: { ...data, rain: { raw: 300, state: 2, remaining: 0 } } }]);
  expect(rainy.split("\r\n")[1]).toMatch(/,"300","下雨","0","","",""$/);
});

it("exports V3 algorithm fields without fabricating legacy values", () => {
 const data = parseFrame("D,1,42,5000,651,36,64,3128,650,67,7,0,0,0,0,30,45,1,0,0") as Telemetry;
 const csv = samplesCsv([{source:"real",session:"v3",device:"HC-08",receivedAt:1000,
   data:{...data,algorithm:{daylight:1,planned:5500,active:true}}}]);
 expect(csv.split("\r\n")[1]).toMatch(/,"白天","5500","1"$/);
});
