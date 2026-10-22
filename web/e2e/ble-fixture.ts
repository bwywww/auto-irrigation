import type { Page } from "@playwright/test";
type State = {
  version: number; daylight: number; planned: number; active: number;
  seq: number;
  uptime: number;
  soilRaw: number;
  soil: number;
  tempRaw: number;
  temp: number;
  lightRaw: number;
  light: number;
  valid: number;
  mode: number;
  valve: number;
  led: number;
  faults: number;
  start: number;
  stop: number;
  ready: number;
  remaining: number;
  cooldown: number;
  rainRaw: number;
  rainState: number;
  rainRemaining: number;
};
declare global {
  interface Window {
    bleTest: {
      patch(value: Partial<State>): void;
      probe(valid: boolean): void;
      pause(value: boolean): void;
      silent(op: string): void;
      disconnect(): void;
      writes: string[];
      requests: unknown[];
    };
  }
}
// Injected only by Playwright. The production page uses navigator.bluetooth unchanged.
export async function installBle(page: Page) {
  await page.addInitScript(() => {
    const t: State = {
      version: 2, daylight: 0, planned: 0, active: 0,
      seq: 0,
      uptime: 5000,
      soilRaw: 651,
      soil: 36,
      tempRaw: 490,
      temp: 2640,
      lightRaw: 650,
      light: 67,
      valid: 7,
      mode: 0,
      valve: 0,
      led: 0,
      faults: 0,
      start: 30,
      stop: 45,
      ready: 1,
      remaining: 0,
      cooldown: 0,
      rainRaw: 900,
      rainState: 1,
      rainRemaining: 0,
    };
    let paused = false,
      suppress = "",
      connected = false,
      input = "",
      timer = 0,
      lastHeart = 0,
      opened = 0,
      duration = 0,
      closed = -Infinity,
      healthy = true,
      good = 3,
      bad = 0;
    const writes: string[] = [],
      requests: unknown[] = [],
      cache = new Map<string, { frame: string; result: string }>();
    const characteristic = Object.assign(new EventTarget(), {
      properties: { notify: true, write: true, writeWithoutResponse: false },
      value: new DataView(new ArrayBuffer(0)),
      startNotifications: async () => characteristic,
      writeValueWithResponse: async (bytes: Uint8Array) => {
        input += new TextDecoder().decode(bytes);
        let index: number;
        while ((index = input.indexOf("\n")) >= 0) {
          const line = input.slice(0, index);
          input = input.slice(index + 1);
          command(line);
        }
      },
    });
    function send(frame: string) {
      if (!connected) return;
      const bytes = new TextEncoder().encode(frame);
      for (let i = 0; i < bytes.length; i += 17) {
        const part = bytes.slice(i, i + 17);
        characteristic.value = new DataView(part.buffer);
        characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
      }
    }
    function emit() {
      if (paused) return;
      t.seq++;
      t.led = t.faults ? 3 : t.valve ? 2 : t.mode ? 1 : 0;
      if (t.rainState !== 1) closeValve();
      t.faults = (t.faults & ~384) | ([2, 3].includes(t.rainState) ? 128 : t.rainState === 4 ? 256 : 0);
      if (t.rainState === 0) t.faults |= 64;
      t.ready = Number(healthy && good >= 3 && !(t.faults & 463) && t.rainState === 1);
      t.remaining = t.valve ? Math.max(0, duration - (Date.now() - opened)) : 0;
      t.cooldown = Math.max(0, 300000 - (Date.now() - closed));
      send(
        [
          "D",
          t.version,
          t.seq,
          t.uptime,
          t.soilRaw,
          t.soil,
          t.tempRaw,
          t.temp,
          t.lightRaw,
          t.light,
          t.valid,
          t.mode,
          t.valve,
          t.led,
          t.faults,
          t.start,
          t.stop,
          t.ready,
          t.remaining,
          t.cooldown,
          t.rainRaw, t.rainState, t.rainRemaining,
          ...(t.version === 3 ? [t.daylight, t.planned, t.active] : []),
        ].join(",") + "\n",
      );
    }
    function closeValve() {
      if (t.valve) closed = Date.now();
      t.valve = 0;
    }
    function lock(bit: number) {
      t.faults |= bit;
      closeValve();
      t.mode = 0;
    }
    function tick() {
      t.uptime += 1000;
      if (healthy) {
        good = Math.min(3, good + 1);
        bad = 0;
      } else {
        good = 0;
        bad++;
        closeValve();
        if (bad >= 3) lock(1);
      }
      if (t.valve && Date.now() - opened >= 60000) lock(2);
      if (t.valve && t.mode === 2 && Date.now() - lastHeart >= 5000) lock(8);
      if (t.valve && t.mode === 2 && Date.now() - opened >= duration)
        closeValve();
      if (t.mode === 1 && healthy && good >= 3 && !t.faults) {
        if (t.valve && t.soil >= t.stop) closeValve();
        else if (
          !t.valve &&
          t.soil <= t.start &&
          Date.now() - closed >= 300000
        ) {
          t.valve = 1;
          opened = Date.now();
          duration = 60000;
        }
      }
      emit();
    }
    function command(frame: string) {
      writes.push(frame);
      const [, , id, op, aText, bText] = frame.split(",");
      const a = Number(aText),
        b = Number(bText);
      if (op === "HB") {
        lastHeart = Date.now();
        return;
      }
      const previous = cache.get(id);
      let result = "OK";
      if (previous)
        result = previous.frame === frame ? previous.result : "ID_CONFLICT";
      else {
        if (op === "STOP") lock(4);
        else if (op === "RESET") {
          closeValve();
          t.mode = 0;
          if (healthy && good >= 3 && !(t.faults & 64) && t.rainState === 1) t.faults = 0;
          else result = "NOT_READY";
        } else if (op === "MODE") {
          if (a !== 0 && t.faults & 15) result = "LOCKED";
          else if (a !== 0 && !t.ready) result = "NOT_READY";
          else {
            if (a !== t.mode) closeValve();
            t.mode = a;
          }
        } else if (op === "WATER") {
          if (!t.ready) result = "NOT_READY";
          else if (t.mode !== 2) result = "NEED_MANUAL";
          else if (t.valve) result = "BUSY";
          else if (Date.now() - lastHeart >= 5000) result = "NEED_HEARTBEAT";
          else {
            t.valve = 1;
            opened = Date.now();
            duration = a * 1000;
          }
        } else if (op === "THRESH") {
          if (t.valve) result = "BUSY";
          else if (!(a >= 0 && a < b && b <= 100)) result = "BAD_ARGUMENT";
          else {
            t.start = a;
            t.stop = b;
          }
        }
        cache.set(id, { frame, result });
      }
      if (op !== suppress) send("A,1," + id + "," + result + "\n");
      emit();
    }
    const server = {
      connect: async () => {
        connected = true;
        input = "";
        window.clearInterval(timer);
        timer = window.setInterval(tick, 1000);
        return server;
      },
      getPrimaryService: async () => ({
        getCharacteristic: async () => characteristic,
      }),
      disconnect: () => {
        if (!connected) return;
        connected = false;
        window.clearInterval(timer);
        device.dispatchEvent(new Event("gattserverdisconnected"));
      },
    };
    const device = Object.assign(new EventTarget(), {
      name: "HC-08 Test",
      gatt: server,
    });
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        requestDevice: async (options: unknown) => {
          requests.push(options);
          return device;
        },
      },
    });
    window.bleTest = {
      writes,
      requests,
      patch(value) {
        Object.assign(t, value);
        emit();
      },
      probe(value) {
        healthy = value;
        good = 0;
        t.soil = value ? 36 : -1;
        t.soilRaw = value ? 651 : 0;
        t.valid = value ? 7 : 6;
        if (!value) closeValve();
        emit();
      },
      pause(value) {
        paused = value;
      },
      silent(op) {
        suppress = op;
      },
      disconnect: server.disconnect,
    };
  });
}
