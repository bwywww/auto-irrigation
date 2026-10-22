import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceClient } from "./client";
import type { Transport } from "./transport";
import { encodeTelemetry, type Telemetry } from "./protocol";
const state: Telemetry = {
  rain: { raw: 900, state: 1, remaining: 0 },
  kind: "data",
  seq: 1,
  uptime: 5000,
  soilRaw: 651,
  soil: 36,
  tempRaw: 490,
  temperature: 26.4,
  lightRaw: 650,
  light: 67,
  valid: 7,
  mode: 0,
  valve: false,
  led: 0,
  faults: 0,
  start: 30,
  stop: 45,
  ready: true,
  remaining: 0,
  cooldown: 0,
};
class Peripheral implements Transport {
  source = "real" as const;
  name = "test";
  writes: string[] = [];
  reply = true;
  data?: (b: Uint8Array) => void;
  disconnect?: () => void;
  async open(data: (b: Uint8Array) => void, disconnect: () => void) {
    this.data = data;
    this.disconnect = disconnect;
  }
  send(line: string) {
    this.data?.(new TextEncoder().encode(line));
  }
  async write(line: string) {
    this.writes.push(line);
    const f = line.trim().split(",");
    if (f[3] === "HB") return;
    if (this.reply || f[3] === "STATUS" || f[3] === "STOP")
      this.send(`A,1,${f[2]},OK\n`);
    if (f[3] === "STATUS") this.send(encodeTelemetry(state));
  }
  close() {}
}
let client: DeviceClient;
it("blocks watering for rain and legacy devices but preserves emergency stop", async () => {
  const peripheral = new Peripheral();
  await client.attach(peripheral);
  peripheral.send(encodeTelemetry({ ...state, seq: 2, ready: false, faults: 128, rain: { raw: 300, state: 2, remaining: 0 } }));
  await expect(client.command("WATER", [5])).rejects.toThrow("雨水检查");
  await expect(client.command("MODE", [1])).rejects.toThrow("雨水检查");
  await expect(client.command("STOP")).resolves.toMatchObject({ result: "OK" });
  const { rain, ...legacy } = state;
  peripheral.send(encodeTelemetry({ ...legacy, seq: 3 }));
  await expect(client.command("MODE", [2])).rejects.toThrow("固件需升级");
  expect(peripheral.writes.some(line => line.includes(",WATER,"))).toBe(false);
});
beforeEach(() => {
  vi.useFakeTimers();
  client = new DeviceClient({
    state: vi.fn(),
    data: vi.fn(),
    pending: vi.fn(),
  });
});
afterEach(() => {
  client.disconnect();
  vi.useRealTimers();
});
describe("device connection and command lifecycle", () => {
  it.each([
    ["none", "未收到蓝牙通知数据"],
    ["invalid", "没有有效 V1/V2/V3 帧"],
    ["data", "传感器数据已到达"],
    ["ack", "没有匹配本次查询编号"],
  ])(
    "explains a failed STATUS handshake with %s input",
    async (kind, message) => {
      const p = new Peripheral();
      p.write = async (line: string) => {
        p.writes.push(line);
        if (!line.includes(",STATUS")) return;
        if (kind === "invalid") p.send("garbled serial data\n");
        if (kind === "data") p.send(encodeTelemetry(state));
        if (kind === "ack") {
          const id = Number(line.split(",")[2]);
          p.send(`A,1,${id === 1 ? 2 : 1},OK\n`);
        }
      };
      const assertion = expect(client.attach(p)).rejects.toThrow(message);
      await vi.advanceTimersByTimeAsync(4200);
      await assertion;
      expect(client.connected).toBe(false);
      const queries = p.writes.filter((line) => line.includes(",STATUS"));
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe(queries[1]);
    },
  );
  it("handshakes and keeps sending heartbeats", async () => {
    const p = new Peripheral();
    await client.attach(p);
    expect(client.fresh).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(p.writes.filter((s) => s.includes(",HB"))).toHaveLength(3);
  });
  it("retries once with the SAME identifier then reports an unknown result", async () => {
    const p = new Peripheral();
    await client.attach(p);
    p.reply = false;
    const pending = client.command("WATER", [5]);
    const assertion = expect(pending).rejects.toThrow("确认超时");
    await vi.advanceTimersByTimeAsync(4100);
    await assertion;
    const writes = p.writes.filter((s) => s.includes(",WATER"));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(writes[1]);
  });
  it("STOP cancels retries of a water command", async () => {
    const p = new Peripheral();
    await client.attach(p);
    p.reply = false;
    const pending = client.command("WATER", [5]);
    const assertion = expect(pending).rejects.toThrow("急停");
    await vi.advanceTimersByTimeAsync(10);
    await client.command("STOP");
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.writes.filter((s) => s.includes(",WATER"))).toHaveLength(1);
  });
  it("disconnect rejects pending operations and 10 reconnects only synchronize status", async () => {
    const p = new Peripheral();
    await client.attach(p);
    p.reply = false;
    const pending = client.command("WATER", [5]);
    const assertion = expect(pending).rejects.toThrow("断开");
    await vi.advanceTimersByTimeAsync(10);
    p.disconnect?.();
    await assertion;
    for (let i = 0; i < 10; i++) {
      const next = new Peripheral();
      await client.attach(next);
      expect(
        next.writes.every((s) => s.includes(",HB") || s.includes(",STATUS")),
      ).toBe(true);
      client.disconnect();
    }
  });
  it("ignores old connection callbacks and detects stale data", async () => {
    const old = new Peripheral();
    await client.attach(old);
    await client.attach(new Peripheral());
    old.send(encodeTelemetry({ ...state, mode: 2 }));
    expect(client.telemetry?.mode).toBe(0);
    await vi.advanceTimersByTimeAsync(5100);
    expect(client.fresh).toBe(false);
    await expect(client.command("MODE", [1])).rejects.toThrow("过期");
    await expect(client.command("STOP")).resolves.toMatchObject({
      result: "OK",
    });
  });
  it("reboot cancels pending operations without replaying them", async () => {
    const p = new Peripheral();
    await client.attach(p);
    p.reply = false;
    const pending = client.command("WATER", [5]);
    const assertion = expect(pending).rejects.toThrow("重启");
    await vi.advanceTimersByTimeAsync(10);
    p.send(encodeTelemetry({ ...state, seq: 0, uptime: 0 }));
    await assertion;
    await vi.advanceTimersByTimeAsync(2200);
    expect(p.writes.filter((s) => s.includes(",WATER"))).toHaveLength(1);
  });
});
