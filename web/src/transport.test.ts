import { afterEach, describe, expect, it, vi } from "vitest";
import { BleTransport, bluetoothUuid } from "./transport";

function peripheral(withoutResponse = true, notify = true) {
  const chunks: Uint8Array[] = [];
  const characteristic = Object.assign(new EventTarget(), {
    properties: {
      notify,
      indicate: false,
      write: !withoutResponse,
      writeWithoutResponse: withoutResponse,
    },
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => characteristic),
    writeValueWithoutResponse: vi.fn(async (bytes: Uint8Array) => {
      chunks.push(bytes.slice());
    }),
    writeValueWithResponse: vi.fn(async (bytes: Uint8Array) => {
      chunks.push(bytes.slice());
    }),
  });
  const getCharacteristic = vi.fn(async () => characteristic);
  const getPrimaryService = vi.fn(async () => ({ getCharacteristic }));
  const device = Object.assign(new EventTarget(), {
    name: "HC-08 test",
    gatt: {
      connect: vi.fn(async () => ({ getPrimaryService })),
      disconnect: vi.fn(),
    },
  });
  const transport = new BleTransport(
    device as unknown as BluetoothDevice,
    bluetoothUuid("ffe0"),
    bluetoothUuid("ffe1"),
  );
  return {
    transport,
    device,
    characteristic,
    chunks,
    getPrimaryService,
    getCharacteristic,
  };
}

afterEach(() => vi.useRealTimers());
describe("native BLE transport", () => {
  it.each([true, false])(
    "chunks writes into at most 20 bytes, withoutResponse=%s",
    async (flag) => {
      vi.useFakeTimers();
      const p = peripheral(flag);
      await p.transport.open(vi.fn(), vi.fn());
      const frame = "C,1,4294967295,THRESH,30,45\n";
      const writing = p.transport.write(frame);
      await vi.advanceTimersByTimeAsync(100);
      await writing;
      expect(p.chunks.map((c) => c.length)).toEqual([20, frame.length - 20]);
      expect(
        new TextDecoder().decode(
          new Uint8Array(p.chunks.flatMap((c) => [...c])),
        ),
      ).toBe(frame);
      expect(
        flag
          ? p.characteristic.writeValueWithResponse
          : p.characteristic.writeValueWithoutResponse,
      ).not.toHaveBeenCalled();
      p.transport.close();
    },
  );
  it("copies notifications with their DataView offset and removes listeners on close", async () => {
    const p = peripheral(),
      data = vi.fn(),
      disconnected = vi.fn();
    await p.transport.open(data, disconnected);
    p.characteristic.value = new DataView(
      new Uint8Array([99, 65, 66, 99]).buffer,
      1,
      2,
    );
    p.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    expect(data).toHaveBeenCalledWith(new Uint8Array([65, 66]));
    p.transport.close();
    p.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    p.device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(data).toHaveBeenCalledTimes(1);
    expect(disconnected).not.toHaveBeenCalled();
  });
  it("cancels remaining chunks if the device disconnects during a write", async () => {
    vi.useFakeTimers();
    const p = peripheral(),
      disconnected = vi.fn();
    await p.transport.open(vi.fn(), disconnected);
    const writing = p.transport.write("C,1,4294967295,THRESH,30,45\n");
    const rejected = expect(writing).rejects.toThrow("取消");
    await vi.advanceTimersByTimeAsync(1);
    p.device.dispatchEvent(new Event("gattserverdisconnected"));
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(p.chunks).toHaveLength(1);
    expect(disconnected).toHaveBeenCalledTimes(1);
    p.transport.close();
  });
  it("gets a new service and characteristic on every reconnect", async () => {
    const p = peripheral();
    for (let i = 0; i < 10; i++) {
      await p.transport.open(vi.fn(), vi.fn());
      p.transport.close();
    }
    expect(p.getPrimaryService).toHaveBeenCalledTimes(10);
    expect(p.getCharacteristic).toHaveBeenCalledTimes(10);
  });
  it("rejects characteristics without notifications and malformed UUIDs", async () => {
    const p = peripheral(true, false);
    await expect(p.transport.open(vi.fn(), vi.fn())).rejects.toThrow("不支持");
    p.transport.close();
    expect(bluetoothUuid(" FFE0 ")).toBe(
      "0000ffe0-0000-1000-8000-00805f9b34fb",
    );
    expect(() => bluetoothUuid("ffe0,STOP")).toThrow();
  });
});
