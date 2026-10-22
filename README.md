# 智慧物联网自动灌溉

基于 Arduino Nano、HC-08 和 Web Bluetooth 的单区灌溉系统。Nano 采集土壤、温度、光照及雨水信号，独立执行灌溉和停水保护。网页提供实时监控、自动与手动控制、历史曲线和 CSV 导出。

## 目录

```text
.
├── firmware/smart_irrigation/   Nano 固件，Arduino IDE 入口
├── web/                        TypeScript 网页、单元测试、浏览器测试
├── tests/                      直接编译实际固件的 C++ 测试与串口替身
├── scripts/start-web.ps1        Windows 网页启动脚本
├── docs/                       接线、算法、协议、校准和测试说明
└── .github/workflows/ci.yml     网页测试、浏览器测试、固件测试和 Nano 编译
```

## 启动网页

安装 Node.js 24 LTS。在仓库根目录执行依赖安装，再启动网页。

```bash
npm --prefix web ci
```

```bash
npm --prefix web run dev
```

在 Windows Chrome 或 Edge 打开 <http://localhost:5173>，点击“连接设备”并选择 HC-08。使用 localhost 或 HTTPS。直接打开 `index.html` 无法运行本项目。浏览器需要支持 Web Bluetooth，Windows 蓝牙须已开启。

Windows 也可使用 [启动脚本](scripts/start-web.ps1)，脚本在首次运行时安装依赖。

网页没有演示模式。未连接实际设备时，传感器读数为空。浏览器测试中的 BLE 替身只用于测试。

## 配置和烧录固件

使用 Arduino IDE 打开 [smart_irrigation.ino](firmware/smart_irrigation/smart_irrigation.ino)。安装 Arduino AVR Boards 和 AltSoftSerial，开发板选择 Arduino Nano，处理器选择 ATmega328P。部分兼容板需要 Old Bootloader。

接线、串口参数和烧录步骤见 [硬件与通信参考](docs/hardware-and-protocol.md)。运行前核对 [Config.h](firmware/smart_irrigation/Config.h) 的引脚、继电器有效电平和传感器校准值。当前配置使用参考测量值，执行器、土壤和雨水配置开关已启用。这些值不能直接代表另一套硬件已通过验证。

电磁阀通过驱动与独立电源连接，不能由 Nano GPIO 直接供电。阀控制输出没有机械阀位或水流反馈。首次验证使用继电器测试灯，按 [雨水保护与标定](docs/rain-calibration.md) 完成停水和恢复测试后再接水路。

## 控制行为

- 上电关阀，进入待机。自动模式需要主动启用。
- 默认湿度 ≤30% 开始补水，≥45% 结束补水。每轮 2～20 秒，两轮之间冷却 5 分钟。
- 手动浇水为 1～30 秒，网页默认 5 秒。手动模式 5 秒无心跳时关阀并锁定。
- 雨水触发立即关闭输出，连续干燥 60 秒才解除限制。
- 急停、土壤异常和连续开阀超时按固件状态机处理，锁定后需要显式复位。
- 关闭网页后，自动控制继续由 Nano 执行。网页关闭期间不保存历史数据。

[功能与工作逻辑](docs/features.md) 描述状态转换，[综合灌溉算法](docs/irrigation-algorithm.md) 描述每轮时长计算。[硬件与通信参考](docs/hardware-and-protocol.md) 记录 V3 数据帧、V1 命令及确认格式。

## 测试

网页单元测试和生产构建使用以下命令。

```bash
npm --prefix web test
```

```bash
npm --prefix web run build
```

浏览器测试默认使用本机 Edge。

```bash
npm --prefix web run test:browser
```

Windows 固件测试使用 `tests/test-firmware.ps1`，Linux 与 macOS 使用 `tests/test-firmware.sh`。完整测试还需 g++、Arduino CLI、Arduino AVR Boards 1.8.8 和 AltSoftSerial 1.4.0。安装命令、仅运行主机测试的方法及本次验证结果见 [测试说明](docs/testing.md)。

## 安全与隐私

发布范围、蓝牙访问控制限制及历史记录隐私见 [安全说明](SECURITY.md)。固件协议没有应用层身份认证，使用前核实 HC-08 的配对和写入权限。

## 上传 GitHub

本目录为仓库根目录，仅包含公开源码和技术文档。依赖、构建产物和测试截图不纳入仓库。发布流程见 [上传说明](docs/publishing.md)。

本项目采用 MIT 许可证，见 [LICENSE](LICENSE)。
