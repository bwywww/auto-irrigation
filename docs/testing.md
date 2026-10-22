# 测试和验收

## 环境

网页使用 Node.js 24 和锁文件安装依赖。生产构建执行 TypeScript 严格检查，再由 Vite 打包。浏览器测试默认使用 Edge，CI 使用 Chromium。

固件测试使用支持 C++11 的 g++。真实 Nano 编译使用 Arduino CLI、Arduino AVR Boards 1.8.8 和 AltSoftSerial 1.4.0。

## 运行网页测试

在仓库根目录安装依赖。

```bash
npm --prefix web ci
```

```bash
npm --prefix web test
```

```bash
npm --prefix web run build
```

本机安装了 Edge 时直接运行浏览器测试。测试自动启动 localhost:5173 服务，端口须空闲。

```bash
npm --prefix web run test:browser
```

Linux 或没有 Edge 的环境先安装 Chromium，再选择测试浏览器。

```bash
npm --prefix web exec -- playwright install --with-deps chromium
```

```bash
PLAYWRIGHT_BROWSER=chromium npm --prefix web run test:browser
```

Windows PowerShell 设置 `$env:PLAYWRIGHT_BROWSER = 'chromium'` 后运行同一 npm 测试命令。

## 运行固件测试

以下安装命令只需在首次准备工具链时执行。

```bash
arduino-cli core update-index
```

```bash
arduino-cli core install arduino:avr@1.8.8
```

```bash
arduino-cli lib install AltSoftSerial@1.4.0
```

Windows PowerShell 在仓库根目录执行 `./tests/test-firmware.ps1`。如果工具不在 PATH，传入 `-Compiler` 和 `-ArduinoCli` 的可执行文件路径。只运行主机测试时传入 `-HostOnly`。

Linux 或 macOS 运行完整测试。

```bash
bash tests/test-firmware.sh
```

只运行主机测试。

```bash
bash tests/test-firmware.sh --host-only
```

可通过 `CXX` 和 `ARDUINO_CLI` 指定工具路径。主机测试直接链接生产固件的 Controller、Sensors 和 Protocol。串口测试包含实际 `.ino`，使用测试时钟、ADC、引脚和串口替身运行主循环。

完整脚本随后编译当前 Nano 配置和临时全启用配置。临时文件保存在 `tests/.build/`，不会修改交付固件。临时配置不用于烧录。

## 测试覆盖和限制

Vitest 检查协议兼容、BLE 分片、指令确认与重试、换算和 IndexedDB 查询。Playwright 通过 BLE 替身驱动正式连接入口，检查手动浇水、急停、复位、历史导出、重连、设置、键盘和不同屏幕宽度。

C++ 测试检查控制状态机、校准换算、雨水保护、心跳、超时、命令去重和计时回绕，并执行加速 24 小时逻辑模拟。串口测试检查实际主循环在发送期间继续处理查询和急停。

这些测试不证明实际 HC-08、传感器、阀门和水路已完成验收。加速模拟不等于实物连续运行 24 小时。实物步骤见 [硬件与通信参考](hardware-and-protocol.md) 和 [雨水标定](rain-calibration.md)。

## 本次整理的验证记录

2026-10-23 在本仓库运行以下检查。环境为 Windows、Node.js 24.16.0、g++ 13.1.0、Arduino CLI 1.5.2-rc.1、AVR Boards 1.8.8。GitHub Actions 尚未远程执行，Linux 与 macOS 尚未实机验证。

| 检查 | 结果 |
|---|---|
| Vitest 4.1.12 | 5 个文件、36 项测试通过 |
| TypeScript 与 Vite 8.3.5 生产构建 | 通过 |
| Edge Playwright | 12 项通过，包含手动控制、急停、雨水、历史、重连、键盘及 1440/1024/390px 布局 |
| PowerShell 固件测试 | 86,906 次控制、传感器、协议断言通过；实际主循环串口测试通过 |
| Bash 主机测试 | 在 Windows Git Bash 下通过同样两组 C++ 测试 |
| 当前配置 Nano 编译 | Flash 14,976/30,720 B，静态 SRAM 1,462/2,048 B |
| 临时全启用配置 Nano 编译 | Flash 15,080/30,720 B，静态 SRAM 1,462/2,048 B |
| npm audit | 更新依赖后 0 项已知漏洞 |
| 发布范围 | 文件名与文本扫描、文档链接、Git 忽略清单检查通过 |

依赖检查发现旧锁文件中的 Vite、Vitest 和 source-map-js 存在公告漏洞。公开副本已更新为 Vite 8.3.5、Vitest 4.1.12 和 source-map-js 1.2.2，并重新测试。AltSoftSerial 编译中的 unused-parameter 警告来自库头文件。

隐私检查只覆盖此次发布的文本文件和文件名。目录不包含 Office 文件、图片、视频或其他二进制附件。
