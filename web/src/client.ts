import {
  FrameDecoder,
  encodeCommand,
  HEARTBEAT,
  resultLabels,
  type Ack,
  type Operation,
  type Telemetry,
} from "./protocol";
import type { Transport } from "./transport";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {}); // may be cancelled while its write is still in progress
  return { promise, resolve, reject };
}
function bounded<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
interface Job extends Deferred<void> {
  frame: string;
}
export interface ClientEvents {
  state(
    value: "connecting" | "connected" | "disconnected",
    reason?: string,
  ): void;
  data(value: Telemetry, rebooted: boolean): void;
  pending(count: number): void;
}
export class DeviceClient {
  connected = false;
  telemetry: Telemetry | null = null;
  receivedAt = 0;
  private decoder = new FrameDecoder();
  private transport?: Transport;
  private epoch = 0;
  private nextId = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  private pending = new Map<number, Deferred<Ack>>();
  private queue: Job[] = [];
  private writing = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private firstData?: Deferred<void>;
  private lastMonotonic = -Infinity;
  constructor(private events: ClientEvents) {}
  get name() {
    return this.transport?.name ?? "";
  }
  get fresh() {
    return (
      this.connected &&
      this.telemetry !== null &&
      performance.now() - this.lastMonotonic < 5000
    );
  }
  get rejectedFrames() {
    return this.decoder.rejected;
  }
  async attach(transport: Transport) {
    this.disconnect();
    this.transport = transport;
    const epoch = ++this.epoch;
    let receivedBytes = 0,
      receivedDataFrames = 0,
      receivedAckFrames = 0;
    this.firstData = deferred<void>();
    this.events.state("connecting");
    try {
      await bounded(
        transport.open(
          (bytes) => {
            if (this.epoch !== epoch) return;
            receivedBytes += bytes.length;
            for (const frame of this.decoder.feed(bytes)) {
              if (frame.kind === "ack") {
                receivedAckFrames++;
                this.pending.get(frame.id)?.resolve(frame);
                continue;
              }
              receivedDataFrames++;
              const old = this.telemetry;
              if (old && old.seq === frame.seq && old.uptime === frame.uptime)
                continue;
              const rebooted =
                old !== null &&
                frame.uptime < old.uptime &&
                old.uptime - frame.uptime < 0x80000000;
              if (rebooted) this.cancelCommands("设备已重启，未完成指令已取消");
              this.telemetry = frame;
              this.receivedAt = Date.now();
              this.lastMonotonic = performance.now();
              this.firstData?.resolve();
              this.events.data(frame, rebooted);
            }
          },
          () => {
            if (this.epoch === epoch) this.disconnect("蓝牙连接已断开");
          },
        ),
        15000,
        "蓝牙连接超时",
      );
      if (epoch !== this.epoch) {
        transport.close();
        throw new Error("连接已取消");
      }
      this.connected = true;
      await this.enqueue(HEARTBEAT);
      this.heartbeat = setInterval(() => {
        if (!this.queue.some((job) => job.frame === HEARTBEAT))
          void this.enqueue(HEARTBEAT).catch(() => {});
      }, 1000);
      try {
        await this.command("STATUS");
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "确认超时")
          throw error;
        const counts = `收到 ${receivedBytes} 字节、${receivedDataFrames} 个数据帧、${receivedAckFrames} 个确认帧`;
        const hint =
          receivedBytes === 0
            ? "未收到蓝牙通知数据，请检查 Nano D9→HC-08 RX、共地和模块串口波特率。"
            : receivedDataFrames > 0
              ? "传感器数据已到达，但没有匹配的查询确认，请优先检查 HC-08 TX→Nano D8 的命令接收线路。"
              : receivedAckFrames > 0
                ? "已收到确认帧，但没有匹配本次查询编号，请核对运行的固件与协议版本。"
                : "收到的内容没有有效 V1/V2/V3 帧，请核对固件、串口波特率和信号电平。";
        throw new Error(`状态查询确认超时：BLE连接已建立；${counts}。${hint}`);
      }
      await bounded(
        this.firstData.promise,
        3000,
        "未收到有效数据，请核对固件、波特率和接线",
      );
      if (epoch !== this.epoch) throw new Error("连接已取消");
      this.events.state("connected");
    } catch (error) {
      if (epoch === this.epoch)
        this.disconnect(error instanceof Error ? error.message : "连接失败");
      transport.close();
      throw error;
    }
  }
  private cancelCommands(reason: string) {
    const error = new Error(reason);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    this.events.pending(0);
  }
  disconnect(reason = "已断开连接") {
    ++this.epoch;
    this.connected = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.cancelCommands(reason);
    this.firstData?.reject(new Error(reason));
    this.transport?.close();
    this.decoder.reset();
    this.telemetry = null;
    this.lastMonotonic = -Infinity;
    this.events.state("disconnected", reason);
  }
  async command(op: Operation, args: number[] = []): Promise<Ack> {
    if (!this.connected) throw new Error("请先连接设备");
    if (op !== "STATUS" && op !== "STOP" && !this.fresh)
      throw new Error("数据已过期，请等待新数据或重新连接");
    if ((op === "WATER" || (op === "MODE" && args[0] !== 0)) && this.telemetry?.rain?.state !== 1)
      throw new Error("雨水检查未通过或固件需升级，禁止开启灌溉");
    if (op === "STOP") this.cancelCommands("已由急停取消");
    else if (this.pending.size >= 1) throw new Error("请等待上一条操作确认");
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    const id = this.nextId,
      frame = encodeCommand(id, op, args),
      pending = deferred<Ack>(),
      epoch = this.epoch;
    this.pending.set(id, pending);
    this.events.pending(this.pending.size);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (epoch !== this.epoch || !this.pending.has(id))
          throw new Error("指令已取消");
        await this.enqueue(frame, op === "STOP");
        let ack: Ack;
        try {
          ack = await bounded(pending.promise, 2000, "确认超时");
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "确认超时" &&
            attempt === 0
          )
            continue;
          throw error;
        }
        if (ack.result !== "OK") throw new Error(resultLabels[ack.result]);
        return ack;
      }
      throw new Error("未收到确认，设备状态未知，请查看最新状态");
    } finally {
      this.pending.delete(id);
      this.events.pending(this.pending.size);
    }
  }
  private enqueue(frame: string, priority = false): Promise<void> {
    if (!this.connected) return Promise.reject(new Error("连接已断开"));
    if (this.queue.length >= 8)
      return Promise.reject(new Error("发送队列已满"));
    const job = Object.assign(deferred<void>(), { frame });
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    void this.drain();
    return job.promise;
  }
  private async drain() {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.queue.length && this.connected) {
        const job = this.queue.shift()!,
          transport = this.transport!,
          epoch = this.epoch;
        try {
          await bounded(transport.write(job.frame), 1500, "蓝牙写入超时");
          if (epoch !== this.epoch) throw new Error("连接已切换");
          job.resolve();
        } catch (error) {
          job.reject(error instanceof Error ? error : new Error("写入失败"));
          if (epoch === this.epoch) this.disconnect("蓝牙写入失败，请重新连接");
        }
      }
    } finally {
      this.writing = false;
    }
  }
}
