import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it, vi } from "vitest";
import { createStorage, samplesCsv, type Sample } from "./storage";
import { parseFrame, type Telemetry } from "./protocol";
import { points, soilScale, wateringIntervals } from "./charts";
const data = parseFrame(
  "D,1,42,5000,651,36,490,2640,650,67,7,0,0,0,0,30,45,1,0,0",
) as Telemetry;
const sample = (time = 1000, session = "a"): Sample => ({
  source: "real",
  receivedAt: time,
  session,
  device: "=HYPERLINK(test)",
  data,
});
it("keeps existing real history and excludes legacy records from queries, events and CSV", async () => {
  const name = crypto.randomUUID();
  let storage = createStorage(name);
  await storage.sample(sample());
  await storage.close();
  const legacy = await openDB(name);
  await legacy.add("samples", {
    ...sample(),
    source: "demo",
    device: "legacy simulator",
  });
  await legacy.add("events", {
    source: "demo",
    receivedAt: 1000,
    session: "old",
    message: "legacy event",
  });
  legacy.close();
  storage = createStorage(name);
  await storage.sample(sample(2000));
  expect(await storage.query(1000, 1000)).toHaveLength(1);
  const rows = await storage.query(0, 3000);
  expect(rows).toHaveLength(2);
  expect(samplesCsv(rows).split("\r\n")).toHaveLength(4);
  expect(samplesCsv(rows)).toContain("'=HYPERLINK(test)");
  expect(samplesCsv(rows)).not.toContain("demo");
  expect(await storage.events(0, 3000)).toHaveLength(0);
  await storage.close();
});
it("returns real events newest first with a bound", async () => {
  const storage = createStorage(crypto.randomUUID());
  for (let i = 0; i < 50; i++)
    await storage.event({ receivedAt: i, session: "a", message: String(i) });
  const events = await storage.events(0, 100);
  expect(events).toHaveLength(40);
  expect(events[0].message).toBe("49");
  expect(await storage.events(100, 200)).toHaveLength(0);
  await storage.close();
});
it("inserts chart gaps for missing data and different connection sessions", () => {
  const series = points(
    [sample(1000), sample(7000), sample(8000, "b")],
    (s) => s.data.soil,
  );
  expect(series.filter((p) => p.y === null)).toHaveLength(2);
});
it("shades watering intervals through the first OFF frame without bridging missing data", () => {
  const row = (time: number, valve: boolean, session = "a"): Sample => ({
    ...sample(time, session), data: { ...data, valve, soil: null },
  });
  expect(wateringIntervals([row(0, false), row(1000, true), row(2000, true), row(3000, false), row(4000, true), row(5000, false)]))
    .toEqual([{ from: 1000, to: 3000 }, { from: 4000, to: 5000 }]);
  expect(wateringIntervals([row(1000, true), row(2000, true), row(8000, true), row(9000, true, "b"), row(10000, false, "b")]))
    .toEqual([{ from: 1000, to: 2000 }, { from: 8000, to: 8000 }, { from: 9000, to: 10000 }]);
  expect(wateringIntervals([row(1000, true)])).toEqual([{ from: 1000, to: 1000 }]);
  expect(wateringIntervals([])).toEqual([]);
  expect(wateringIntervals([row(1000, false)])).toEqual([]);
});
it("keeps brief extremes and original history when zooming the soil axis", () => {
  const samples = Array.from({ length: 2000 }, (_, i) => ({ ...sample(i * 1000), data: { ...data, soil: 14 } }));
  samples[101].data.soil = 100;
  samples[103].data.soil = 3;
  const series = points(samples, s => s.data.soil);
  expect(series).toContainEqual({ x: 101000, y: 100 });
  expect(series).toContainEqual({ x: 103000, y: 3 });
  expect(soilScale(samples, 20)).toMatchObject({ max: 20, count: 1, markers: [{ x: 101000, y: 20, actualY: 100 }] });
  expect(soilScale(samples, 100)).toMatchObject({ max: 100, count: 0, markers: [] });
  expect(samples[101].data.soil).toBe(100);
  expect(soilScale([], 20)).toEqual({ max: 20, count: 0, markers: [] });
});
it("turns synchronous storage denial into a rejected operation", async () => {
  const stub = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new DOMException("Storage denied", "SecurityError");
  });
  try {
    await expect(createStorage("denied").sample(sample())).rejects.toThrow(
      "Storage denied",
    );
  } finally {
    stub.mockRestore();
  }
});
