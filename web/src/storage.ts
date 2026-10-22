import { daylightLabels } from "./protocol";
import { openDB, type DBSchema } from "idb";
import type { Telemetry } from "./protocol";
import { rainLabels } from "./protocol";
import { estimatedLux } from "./measurements";
export interface Sample {
  id?: number;
  source: "real";
  session: string;
  device: string;
  receivedAt: number;
  data: Telemetry;
}
export interface LogEvent {
  id?: number;
  source: "real";
  session: string;
  receivedAt: number;
  message: string;
}
interface IrrigationDB extends DBSchema {
  samples: {
    key: number;
    value: Omit<Sample, "source"> & { source: string };
    indexes: { "source-time": [string, number] };
  };
  events: {
    key: number;
    value: Omit<LogEvent, "source"> & { source: string };
    indexes: { "source-time": [string, number] };
  };
}
export function createStorage(name = "smart-irrigation-v1") {
  const db = Promise.resolve().then(() =>
    openDB<IrrigationDB>(name, 1, {
      upgrade(database) {
        const samples = database.createObjectStore("samples", {
          keyPath: "id",
          autoIncrement: true,
        });
        samples.createIndex("source-time", ["source", "receivedAt"]);
        const events = database.createObjectStore("events", {
          keyPath: "id",
          autoIncrement: true,
        });
        events.createIndex("source-time", ["source", "receivedAt"]);
      },
    }),
  );
  void db.catch(() => {});
  return {
    async sample(sample: Omit<Sample, "source">) {
      await (await db).add("samples", { ...sample, source: "real" });
    },
    async event(event: Omit<LogEvent, "source">) {
      await (await db).add("events", { ...event, source: "real" });
    },
    async query(from: number, to: number): Promise<Sample[]> {
      return (await (
        await db
      ).getAllFromIndex(
        "samples",
        "source-time",
        IDBKeyRange.bound(["real", from], ["real", to]),
      )) as Sample[];
    },
    async events(from: number, to: number): Promise<LogEvent[]> {
      const database = await db;
      let cursor = await database
        .transaction("events")
        .store.index("source-time")
        .openCursor(IDBKeyRange.bound(["real", from], ["real", to]), "prev");
      const result: LogEvent[] = [];
      while (cursor && result.length < 40) {
        result.push(cursor.value as LogEvent);
        cursor = await cursor.continue();
      }
      return result;
    },
    async close() {
      (await db).close();
    },
  };
}
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function samplesCsv(samples: Sample[]): string {
  const header = [
    "接收时间ISO",
    "数据来源",
    "会话",
    "设备",
    "序号",
    "运行毫秒",
    "土壤ADC",
    "相对土壤湿度%",
    "温度ADC",
    "温度℃",
    "光照ADC",
    "相对光照%",
    "模式",
    "阀门控制输出",
    "LED状态",
    "故障码",
    "启动阈值%",
    "停止阈值%",
    "估算照度lux",
    "雨水ADC", "雨水状态", "干燥确认剩余毫秒",
    "昼夜状态", "本轮计划毫秒", "补水过程进行中",
  ];
  const rows = samples.map((s) => {
    const t = s.data;
    return [
      new Date(s.receivedAt).toISOString(),
      s.source,
      s.session,
      s.device,
      t.seq,
      t.uptime,
      t.soilRaw,
      t.soil,
      t.tempRaw,
      t.temperature,
      t.lightRaw,
      t.light,
      t.mode,
      Number(t.valve),
      t.led,
      t.faults,
      t.start,
      t.stop,
      estimatedLux(t),
      t.rain?.raw, t.rain ? rainLabels[t.rain.state] : null, t.rain?.remaining,
      t.algorithm ? daylightLabels[t.algorithm.daylight] : null, t.algorithm?.planned, t.algorithm ? +t.algorithm.active : null,
    ]
      .map(csvCell)
      .join(",");
  });
  return (
    "\uFEFF" +
    header.map(csvCell).join(",") +
    "\r\n" +
    rows.join("\r\n") +
    "\r\n"
  );
}
