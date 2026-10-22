export const MAX_FRAME = 192;
export type Mode = 0 | 1 | 2;
export type RainState = 0 | 1 | 2 | 3 | 4;
export const rainLabels = ["待校准", "未下雨", "下雨", "等待干燥确认", "采样异常"] as const;
export const daylightLabels = ["待判断", "白天", "晚上"] as const;
export interface Telemetry {
  kind: "data";
  seq: number;
  uptime: number;
  soilRaw: number;
  soil: number | null;
  tempRaw: number;
  temperature: number | null;
  lightRaw: number;
  light: number | null;
  valid: number;
  mode: Mode;
  valve: boolean;
  led: number;
  faults: number;
  start: number;
  stop: number;
  ready: boolean;
  remaining: number;
  cooldown: number;
  // Absent on V1 devices and existing history: never interpret absence as dry.
  algorithm?: { daylight: 0 | 1 | 2; planned: number; active: boolean };
  rain?: { raw: number; state: RainState; remaining: number };
}
export interface Ack {
  kind: "ack";
  id: number;
  result: string;
}
export type Frame = Telemetry | Ack;
export type Operation =
  "STATUS" | "MODE" | "WATER" | "STOP" | "RESET" | "THRESH";
export const resultLabels: Record<string, string> = {
  OK: "已确认",
  BAD_COMMAND: "未知命令",
  BAD_ARGUMENT: "参数无效",
  NOT_READY: "校准或传感器检查未通过",
  LOCKED: "设备已锁定，请排查后复位",
  BUSY: "正在浇水，请先停止",
  NEED_MANUAL: "请先切换手动模式",
  NEED_HEARTBEAT: "连接心跳过期",
  ID_CONFLICT: "命令编号冲突，请重新连接",
  QUEUE_FULL: "设备忙",
};
function integer(value: string, min: number, max: number): number {
  if (!/^-?\d+$/.test(value)) throw new Error("非整数");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error("越界");
  return n;
}
export function parseFrame(line: string): Frame | null {
  if (line.length + 1 > MAX_FRAME) return null;
  const f = line.split(",");
  try {
    if (f[0] === "A" && f[1] === "1" && f.length === 4 && Object.hasOwn(resultLabels, f[3])) {
      return { kind: "ack", id: integer(f[2], 1, 0xffffffff), result: f[3] };
    }
    if (f[0] !== "D" || !((f[1] === "1" && f.length === 20) || (f[1] === "2" && f.length === 23) || (f[1] === "3" && f.length === 26))) return null;
    const rain = f[1] !== "1" ? {
      raw: integer(f[20], 0, 1023),
      state: integer(f[21], 0, 4) as RainState,
      remaining: integer(f[22], 0, 60000),
    } : undefined;
    const algorithm = f[1] === "3" ? {
      daylight: integer(f[23], 0, 2) as 0 | 1 | 2,
      planned: integer(f[24], 0, 20000),
      active: Boolean(integer(f[25], 0, 1)),
    } : undefined;
    const valid = integer(f[10], 0, 7);
    const soil = integer(f[5], -1, 100),
      temp = integer(f[7], -32768, 12500),
      light = integer(f[9], -1, 100);
    if (
      Boolean(valid & 1) !== soil >= 0 ||
      Boolean(valid & 2) !== (temp !== -32768) ||
      Boolean(valid & 4) !== light >= 0 ||
      (temp !== -32768 && temp < -4000)
    )
      return null;
    const start = integer(f[15], 0, 99),
      stop = integer(f[16], 1, 100);
    if (start >= stop) return null;
    const mode = integer(f[11], 0, 2) as Mode;
    const valve = Boolean(integer(f[12], 0, 1));
    const faults = integer(f[14], 0, rain ? 511 : 127),
      ready = Boolean(integer(f[17], 0, 1));
    if (
      (ready && (!(valid & 1) || faults & 463 || (rain && rain.state !== 1))) ||
      (valve && (!ready || mode === 0))
    )
      return null;
    if (rain && (
      (rain.state !== 3 && rain.remaining !== 0) ||
      Boolean(faults & 128) !== (rain.state === 2 || rain.state === 3) ||
      Boolean(faults & 256) !== (rain.state === 4) ||
      (rain.state === 0 && !(faults & 64))
    )) return null;
    if (algorithm && (
      (algorithm.active && (mode !== 1 || !ready)) ||
      (mode === 1 && valve && (!algorithm.active || algorithm.planned < 2000 || Number(f[18]) > algorithm.planned)) ||
      (!(mode === 1 && valve) && algorithm.planned !== 0)
    )) return null;
    return {
      kind: "data",
      seq: integer(f[2], 0, 0xffffffff),
      uptime: integer(f[3], 0, 0xffffffff),
      soilRaw: integer(f[4], 0, 1023),
      soil: soil < 0 ? null : soil,
      tempRaw: integer(f[6], 0, 1023),
      temperature: temp === -32768 ? null : temp / 100,
      lightRaw: integer(f[8], 0, 1023),
      light: light < 0 ? null : light,
      valid,
      mode,
      valve,
      led: integer(f[13], 0, 3),
      faults,
      start,
      stop,
      ready,
      remaining: integer(f[18], 0, 60000),
      cooldown: integer(f[19], 0, 300000),
      ...(rain ? { rain } : {}),
      ...(algorithm ? { algorithm } : {}),
    };
  } catch {
    return null;
  }
}
export class FrameDecoder {
  private line = "";
  private discard = false;
  private carriageReturn = false;
  rejected = 0;
  feed(bytes: Uint8Array): Frame[] {
    const frames: Frame[] = [];
    for (const b of bytes) {
      if (b === 10) {
        const frame = !this.discard && this.line ? parseFrame(this.line) : null;
        if (frame) frames.push(frame);
        else if (this.line || this.discard) this.rejected++;
        this.line = "";
        this.discard = false;
        this.carriageReturn = false;
      } else if (this.carriageReturn) {
        this.discard = true;
      } else if (b === 13) {
        if (this.line.length >= MAX_FRAME - 1) this.discard = true;
        this.carriageReturn = true;
      } else {
        if (b < 32 || b > 126 || this.line.length >= MAX_FRAME - 1)
          this.discard = true;
        if (!this.discard) this.line += String.fromCharCode(b);
      }
    }
    return frames;
  }
  reset() {
    this.line = "";
    this.discard = false;
    this.carriageReturn = false;
  }
}
export function encodeCommand(
  id: number,
  op: Operation,
  args: number[] = [],
): string {
  if (
    !Number.isInteger(id) ||
    id < 1 ||
    id > 0xffffffff ||
    !args.every(Number.isInteger)
  )
    throw new Error("命令参数无效");
  const valid =
    (["STATUS", "STOP", "RESET"].includes(op) && args.length === 0) ||
    (op === "MODE" && args.length === 1 && args[0] >= 0 && args[0] <= 2) ||
    (op === "WATER" && args.length === 1 && args[0] >= 1 && args[0] <= 30) ||
    (op === "THRESH" &&
      args.length === 2 &&
      args[0] >= 0 &&
      args[0] < args[1] &&
      args[1] <= 100);
  if (!valid) throw new Error("命令参数无效");
  return `C,1,${id},${op}${args.length ? "," + args.join(",") : ""}\n`;
}
export const HEARTBEAT = "C,1,0,HB\n";
export function encodeTelemetry(t: Telemetry): string {
  return (
    [
      "D",
      t.algorithm ? 3 : t.rain ? 2 : 1,
      t.seq,
      t.uptime,
      t.soilRaw,
      t.soil ?? -1,
      t.tempRaw,
      t.temperature === null ? -32768 : Math.round(t.temperature * 100),
      t.lightRaw,
      t.light ?? -1,
      t.valid,
      t.mode,
      +t.valve,
      t.led,
      t.faults,
      t.start,
      t.stop,
      +t.ready,
      t.remaining,
      t.cooldown,
      ...(t.rain ? [t.rain.raw, t.rain.state, t.rain.remaining] : []),
      ...(t.algorithm ? [t.algorithm.daylight, t.algorithm.planned, +t.algorithm.active] : []),
    ].join(",") + "\n"
  );
}
