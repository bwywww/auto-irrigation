export interface Transport {
  readonly name: string;
  open(
    data: (bytes: Uint8Array) => void,
    disconnected: () => void,
  ): Promise<void>;
  write(frame: string): Promise<void>;
  close(): void;
}
export function bluetoothUuid(value: string): string {
  const s = value.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s))
    return s;
  throw new Error("蓝牙UUID格式无效");
}
export class BleTransport implements Transport {
  readonly name: string;
  private characteristic?: BluetoothRemoteGATTCharacteristic;
  private data?: (bytes: Uint8Array) => void;
  private disconnected?: () => void;
  private active = false;
  private generation = 0;
  private onDisconnect = () => {
    this.active = false;
    this.disconnected?.();
  };
  private onNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (this.active && value)
      this.data?.(
        new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).slice(),
      );
  };
  constructor(
    private device: BluetoothDevice,
    private serviceUuid: string,
    private characteristicUuid: string,
  ) {
    this.name = device.name || "未命名BLE设备";
  }
  static async select(
    service = "ffe0",
    characteristic = "ffe1",
  ): Promise<BleTransport> {
    if (!window.isSecureContext)
      throw new Error("请通过 localhost 或 HTTPS 打开网页");
    if (!navigator.bluetooth)
      throw new Error("当前浏览器不支持蓝牙，请使用 Windows Chrome 或 Edge");
    const serviceUuid = bluetoothUuid(service),
      characteristicUuid = bluetoothUuid(characteristic);
    // Some HC-08 revisions advertise FFF0 while exposing FFE0. Do not filter by service advertisement.
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [serviceUuid],
    });
    return new BleTransport(device, serviceUuid, characteristicUuid);
  }
  async open(data: (bytes: Uint8Array) => void, disconnected: () => void) {
    this.data = data;
    this.disconnected = disconnected;
    const generation = ++this.generation;
    this.device.addEventListener("gattserverdisconnected", this.onDisconnect);
    const server = await this.device.gatt?.connect();
    if (!server || generation !== this.generation) {
      this.device.gatt?.disconnect();
      throw new Error("连接已取消");
    }
    const service = await server.getPrimaryService(this.serviceUuid);
    const characteristic = await service.getCharacteristic(
      this.characteristicUuid,
    );
    if (generation !== this.generation) {
      this.device.gatt?.disconnect();
      throw new Error("连接已取消");
    }
    if (
      !(
        characteristic.properties.notify || characteristic.properties.indicate
      ) ||
      !(
        characteristic.properties.write ||
        characteristic.properties.writeWithoutResponse
      )
    ) {
      throw new Error("所选特征不支持数据通知和写入，请核对HC-08的UUID");
    }
    this.characteristic = characteristic;
    characteristic.addEventListener(
      "characteristicvaluechanged",
      this.onNotification,
    );
    this.active = true;
    await characteristic.startNotifications();
    if (generation !== this.generation) {
      this.close();
      throw new Error("连接已取消");
    }
  }
  async write(frame: string) {
    const c = this.characteristic,
      generation = this.generation;
    if (!this.active || !c) throw new Error("蓝牙连接已断开");
    const bytes = new TextEncoder().encode(frame);
    for (let offset = 0; offset < bytes.length; offset += 20) {
      if (!this.active || generation !== this.generation)
        throw new Error("连接已断开，指令取消");
      const chunk = bytes.slice(offset, offset + 20);
      if (c.properties.writeWithoutResponse)
        await c.writeValueWithoutResponse(chunk);
      else await c.writeValueWithResponse(chunk);
      if (offset + 20 < bytes.length)
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  close() {
    ++this.generation;
    this.active = false;
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotification,
    );
    this.device.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnect,
    );
    this.device.gatt?.disconnect();
    this.characteristic = undefined;
  }
}
