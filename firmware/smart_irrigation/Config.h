#pragma once
#include <Arduino.h>

// 新版单区引脚。请不要照旧版双区接线烧录本程序。
constexpr uint8_t SOIL_PIN = A0, LIGHT_PIN = A1, TEMP_PIN = A2;
constexpr uint8_t RAIN_PIN = A3;
// 实测：干燥ADC=0，沾湿>=400（可超过600）。400作湿参考，不是ADC上限。
constexpr bool RAIN_CONFIGURED = true;
constexpr int RAIN_DRY_RAW = 0, RAIN_WET_RAW = 400;
// 20%对应ADC>=80触发；整数换算<=10%对应ADC<=43，连续60秒解除。
constexpr uint8_t RAIN_START_PERCENT = 20, RAIN_CLEAR_PERCENT = 10;
constexpr uint32_t RAIN_SAMPLE_MS = 250, RAIN_DRY_CONFIRM_MS = 60000;
constexpr uint8_t VALVE_PIN = 3, LED_PIN = 6;
// AltSoftSerial固定：D8 RX <- HC-08 TX；D9 TX -> 分压/电平转换 -> HC-08 RX。
constexpr uint32_t BLUETOOTH_BAUD = 9600, DEBUG_BAUD = 115200;
constexpr bool RELAY_ACTIVE_LOW = false;

// 执行器仍需核实驱动/电源/复位关闭电平。土壤采用配置的参考端点。
constexpr bool ACTUATOR_VERIFIED = true;
constexpr bool SOIL_CALIBRATED = true;
constexpr int SOIL_DRY_RAW = 700, SOIL_WET_RAW = 400;  // 湿度=(700-ADC)/3，实物需对照
// V1兼容字段：网页使用原始ADC计算估算lux，不使用下面的相对光照百分比。
constexpr bool LIGHT_CALIBRATED = false;
constexpr int LIGHT_DARK_RAW = 50, LIGHT_BRIGHT_RAW = 950;
// 线性温度换算公式：摄氏度 = ADC * (5.0 / 1023.0 * 100)。
// 使用默认ADC参考；5.0代表参考电压，100代表每伏对应的摄氏度。
constexpr float TEMP_REFERENCE_VOLTS = 5.0F, TEMP_C_PER_VOLT = 100.0F;
constexpr uint8_t START_PERCENT = 30, STOP_PERCENT = 45;
constexpr uint32_t SAMPLE_MS = 1000, MAX_WATER_MS = 60000, COOLDOWN_MS = 300000;
constexpr uint32_t HEARTBEAT_TIMEOUT_MS = 5000, SENSOR_STALE_MS = 3500;

// 多传感器经验控制参数；需结合实际水流与土壤响应标定。
constexpr uint32_t AUTO_BASE_MS = 5000, AUTO_MIN_MS = 2000, AUTO_MAX_MS = 20000;
constexpr float AUTO_REFERENCE_C = 25, AUTO_TEMP_SLOPE = 0.02F;
constexpr float AUTO_TEMP_MIN = 0.8F, AUTO_TEMP_MAX = 1.2F;
constexpr float AUTO_DAY_FACTOR = 1.1F, AUTO_NIGHT_FACTOR = 0.9F;
constexpr uint16_t DAY_LUX = 300, NIGHT_LUX = 200;
