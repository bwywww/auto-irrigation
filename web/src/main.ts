import { daylightLabels } from "./protocol";
import "./style.css";
import { page } from "./view";
import { DeviceClient } from "./client";
import { BleTransport } from "./transport";
import { HistoryCharts } from "./charts";
import { estimatedLux } from "./measurements";
import { createStorage, samplesCsv } from "./storage";
import type { Operation, Telemetry } from "./protocol";
import { rainLabels } from "./protocol";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const text = (id: string, value: string) => {
  $(id).textContent = value;
};
$("app").innerHTML = page;
const storage = createStorage();
let charts: HistoryCharts | undefined;
let latest: Telemetry | null = null,
  previous: Telemetry | null = null;
let session = crypto.randomUUID(),
  deviceName = "";
let connecting = false,
  connectionAttempt = 0,
  pendingCount = 0,
  queryVersion = 0,
  operationVersion = 0;
let operationMessage = "";
let activeTab: "monitor" | "history" = "monitor";
const settings = $<HTMLDialogElement>("settings");
const feedback = $("pending");
const feedbackAnchor = document.createComment("feedback");
feedback.before(feedbackAnchor);
const emergency = $("stop"),
  emergencyAnchor = document.createComment("emergency");
emergency.before(emergencyAnchor);
const notices = ["faults", "storage-error"].map((id) => {
  const element = $(id),
    anchor = document.createComment(id);
  element.before(anchor);
  return { element, anchor };
});
const modes = ["待机", "自动", "手动"];
const ledStates = ["熄灭", "慢闪", "常亮", "快闪"];
const faults: [number, string][] = [
  [1, "土壤传感器异常或采样超时"],
  [2, "连续浇水超时"],
  [4, "急停已锁定"],
  [8, "手动浇水因失联停止"],
  [16, "温度读数异常"],
  [32, "光照读数异常"],
  [64, "配置未完成，请在设置中查看校准要求"],
  [128, "雨水保护：暂停灌溉"],
  [256, "雨水采样异常：禁止灌溉"],
];
const describeFaults = (mask: number) =>
  faults
    .filter(([bit]) => mask & bit)
    .map(([, label]) => label)
    .join("；");

const client = new DeviceClient({
  state(state, reason) {
    connecting = state === "connecting";
    if (state === "connected") {
      record("已连接 " + deviceName);
      operationMessage = "";
    }
    if (state === "disconnected" && previous) {
      record(reason || "已断开连接");
      previous = null;
    }
    render();
  },
  data(data, rebooted) {
    if (rebooted) {
      session = crypto.randomUUID();
      record("Nano 已重启");
      previous = null;
    }
    latest = data;
    void storage
      .sample({ session, device: deviceName, receivedAt: Date.now(), data })
      .catch(storageFailure);
    if (previous) {
      if (previous.valve !== data.valve)
        record("阀门控制输出：" + (data.valve ? "开启" : "关闭"));
      if (previous.mode !== data.mode) record("运行模式：" + modes[data.mode]);
      if (previous.faults !== data.faults)
        record(data.faults ? describeFaults(data.faults) : "故障已解除");
      if (previous.rain?.state !== data.rain?.state)
        record("雨水状态：" + (data.rain ? rainLabels[data.rain.state] : "无雨水数据"));
    }
    previous = data;
    render();
  },
  pending(count) {
    pendingCount = count;
    render();
  },
});
function record(message: string) {
  void storage
    .event({ session, receivedAt: Date.now(), message })
    .catch(storageFailure);
}
function storageFailure(error: unknown) {
  text(
    "storage-error",
    "历史存储不可用，设备控制仍可使用。" +
      (error instanceof Error ? error.message : ""),
  );
  $("storage-error").classList.remove("hidden");
}
function render() {
  const connected = client.connected,
    fresh = client.fresh,
    t = latest;
  $("connection-dot").classList.toggle("live", fresh);
  text(
    "connection-label",
    connecting ? "连接中…" : connected ? deviceName : "未连接",
  );
  text(
    "fresh-label",
    fresh
      ? "更新于 " + new Date(client.receivedAt).toLocaleTimeString("zh-CN")
      : t
        ? "数据已过期"
        : "等待数据",
  );
  $("connect").classList.toggle("hidden", connected || connecting);
  $("disconnect").classList.toggle("hidden", !connected && !connecting);
  $<HTMLButtonElement>("stop").disabled = !connected;
  for (const name of ["soil", "temp", "light"])
    $(name + "-reading").classList.toggle("stale", !!t && !fresh);
  text("soil-value", t?.soil == null ? "—" : String(t.soil));
  text("temp-value", t?.temperature == null ? "—" : t.temperature.toFixed(1));
  const lux = t ? estimatedLux(t) : null;
  text("light-value", lux === null ? "—" : lux.toFixed(1));
  text("light-unit", "lux");
  text("rain-state", !t ? "等待采集" : !fresh ? "状态未知" : t.rain ? rainLabels[t.rain.state] : "旧固件无雨水保护");
  text("rain-detail", !t ? "" : !fresh ? "数据已过期，等待新采样" : !t.rain ? "请上传支持雨水保护的新版固件" :
    t.rain.state === 0 ? "请在设置中读取ADC并完成校准" :
    t.rain.state === 3 ? `持续干燥确认：还需约${Math.ceil(t.rain.remaining / 1000)}秒` :
    t.rain.state === 1 ? "允许按湿度与冷却条件判断" : "自动与手动灌溉均已禁止");
  $("rain-status").classList.toggle("rain-blocked", !!t && t.rain?.state !== 1);
  text(
    "soil-quality",
    !t
      ? "等待采集"
      : t.faults & 1
        ? "读数异常"
        : t.soil === null
          ? "待校准"
          : t.soil <= t.start
            ? "湿度偏低"
            : t.soil >= t.stop
              ? "湿度达标"
              : "湿度适宜",
  );
  text(
    "temp-quality",
    !t
      ? "等待采集"
      : t.faults & 16
        ? "读数异常"
        : t.temperature === null
          ? "暂无有效温度"
          : "读数正常",
  );
  text(
    "light-quality",
    !t
      ? "等待采集"
      : lux === null
        ? "读数异常"
        : "估算照度 · " + (fresh && t.algorithm ? daylightLabels[t.algorithm.daylight] : "待判断"),
  );
  text(
    "valve-state",
    !t ? "—" : !fresh ? "未知 · 已失联" : t.valve ? "开启" : "关闭",
  );
  $("valve-state").classList.toggle("on", fresh && !!t?.valve);
  text(
    "timer-label",
    fresh && t?.valve
      ? "浇水中 · 剩余时间"
      : fresh && t?.cooldown
        ? (t.algorithm?.active ? "等待渗透" : "自动冷却")
        : "运行状态",
  );
  text(
    "remaining-state",
    !t
      ? "等待连接"
      : !fresh
        ? "数据已过期"
        : t.valve
          ? Math.ceil(t.remaining / 1000) + " 秒"
          : t.cooldown
            ? Math.ceil(t.cooldown / 1000) + " 秒"
            : t.mode === 1 ? "自动监测" : modes[t.mode],
  );
  text("control-version", t && !t.algorithm ? "旧控制版本：未启用综合公式" : "");
  text("faults", t ? describeFaults(t.faults) : "");
  $("faults").classList.toggle("hidden", !t?.faults);
  const available = fresh && !connecting && pendingCount === 0;
  ["standby", "auto", "manual"].forEach((name, i) => {
    const b = $<HTMLButtonElement>("mode-" + name);
    b.disabled = !available || (i > 0 && (!t?.ready || t.rain?.state !== 1));
    b.classList.toggle("selected", fresh && t?.mode === i);
    b.setAttribute("aria-pressed", String(fresh && t?.mode === i));
  });
  $("manual-controls").classList.toggle("hidden", !connected || t?.mode !== 2);
  $<HTMLButtonElement>("water").disabled =
    !available || !t?.ready || t.rain?.state !== 1 || t.mode !== 2 || t.valve;
  $("reset").classList.toggle("hidden", !t || !(t.faults & 15));
  $<HTMLButtonElement>("reset").disabled = !available;
  $<HTMLButtonElement>("apply-threshold").disabled = !available || !!t?.valve;
  for (const id of ["start-threshold", "stop-threshold"])
    $<HTMLInputElement>(id).disabled = !available || !!t?.valve;
  for (const id of ["service-uuid", "characteristic-uuid"])
    $<HTMLInputElement>(id).disabled = connected || connecting;
  text(
    "threshold-state",
    t
      ? t.start + "% 启动 / " + t.stop + "% 停止 · 仅关阀可改，重启恢复默认"
      : "仅关阀时可修改，重启恢复默认值。",
  );
  text("soil-raw", t ? String(t.soilRaw) : "—");
  text("temp-raw", t ? String(t.tempRaw) : "—");
  text("light-raw", t ? String(t.lightRaw) : "—");
  text("rain-raw", t?.rain ? String(t.rain.raw) : "—");
  text("led-state", fresh && t ? ledStates[t.led] : "—");
  text(
    "diagnostic",
    t
      ? "运行 " +
          Math.floor(t.uptime / 1000) +
          " 秒 · 序号 " +
          t.seq +
          " · 无效帧 " +
          client.rejectedFrames +
          (fresh ? "" : " · 数据已过期")
      : "尚未收到设备数据。",
  );
  text("pending", pendingCount ? "等待设备确认…" : operationMessage);
}
async function operate(op: Operation, args: number[], label: string) {
  const version = ++operationVersion;
  try {
    operationMessage = "";
    await client.command(op, args);
    if (version === operationVersion) operationMessage = label + "：设备已确认";
    record(label + "：设备已确认");
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    if (version === operationVersion) operationMessage = message;
    record(label + "：" + message);
  } finally {
    render();
    if (activeTab === "history") void refreshHistory();
  }
}
async function connect() {
  const attempt = ++connectionAttempt;
  connecting = true;
  operationMessage = "";
  render();
  try {
    const transport = await BleTransport.select(
      $<HTMLInputElement>("service-uuid").value,
      $<HTMLInputElement>("characteristic-uuid").value,
    );
    if (attempt !== connectionAttempt) {
      transport.close();
      return;
    }
    latest = previous = null;
    session = crypto.randomUUID();
    deviceName = transport.name;
    await client.attach(transport);
  } catch (error) {
    if (attempt === connectionAttempt)
      operationMessage =
        error instanceof DOMException && error.name === "NotFoundError"
          ? "已取消设备选择"
          : error instanceof Error
            ? error.message
            : "连接失败";
  } finally {
    if (attempt === connectionAttempt) {
      connecting = false;
      render();
    }
  }
}
function historyBounds() {
  const range = $<HTMLSelectElement>("history-range").value;
  if (range !== "custom") {
    const to = Date.now();
    return { to, from: to - Number(range) * 3600000 };
  }
  const from = new Date($<HTMLInputElement>("history-from").value).getTime(),
    to = new Date($<HTMLInputElement>("history-to").value).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new RangeError("请选择有效的起止时间");
  return { from, to };
}
async function refreshHistory() {
  const version = ++queryVersion;
  try {
    const { from, to } = historyBounds();
    const [samples, events] = await Promise.all([
      storage.query(from, to),
      storage.events(from, to),
    ]);
    if (version !== queryVersion) return;
    const scale = charts?.update(samples, Number($<HTMLSelectElement>("soil-scale").value));
    if (scale) text("soil-scale-note", `湿度纵轴 0～${scale.max}%` +
      (scale.count ? ` · ${scale.count} 条记录超出刻度，顶部橙色三角标记；悬停查看原值，选择0～100%查看全貌。` : " · 仅调整显示比例，原始记录不变。"));
    $("chart-empty").classList.toggle("hidden", samples.length > 0);
    text("history-count", samples.length.toLocaleString() + " 条记录");
    const list = $("events");
    list.replaceChildren();
    if (!events.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "暂无事件";
      list.append(li);
    }
    for (const event of events) {
      const li = document.createElement("li"),
        time = document.createElement("time"),
        span = document.createElement("span");
      time.textContent = new Date(event.receivedAt).toLocaleString("zh-CN");
      time.dateTime = new Date(event.receivedAt).toISOString();
      span.textContent = event.message;
      li.append(time, span);
      list.append(li);
    }
  } catch (error) {
    if (error instanceof RangeError) {
      charts?.update([], Number($<HTMLSelectElement>("soil-scale").value));
      text("soil-scale-note", "");
      $("events").replaceChildren();
      $("chart-empty").classList.remove("hidden");
      text("history-count", error.message);
      return;
    }
    storageFailure(error);
    text("history-count", "历史读取失败");
  }
}
function switchTab(tab: "monitor" | "history") {
  activeTab = tab;
  for (const name of ["monitor", "history"] as const) {
    $(name).hidden = tab !== name;
    $("tab-" + name).setAttribute("aria-selected", String(tab === name));
    $("tab-" + name).tabIndex = tab === name ? 0 : -1;
  }
  if (tab === "history") {
    charts ??= new HistoryCharts(
      $("soil-chart"),
      $("temp-chart"),
      $("light-chart"),
    );
    void refreshHistory();
  }
}
for (const tab of ["monitor", "history"] as const) {
  $("tab-" + tab).addEventListener("click", () => switchTab(tab));
  $("tab-" + tab).addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "monitor"
        : event.key === "End"
          ? "history"
          : tab === "monitor"
            ? "history"
            : "monitor";
    switchTab(next);
    $("tab-" + next).focus();
  });
}
$("connect").addEventListener("click", () => {
  void connect();
});
$("disconnect").addEventListener("click", () => {
  ++connectionAttempt;
  const finish = () => {
    client.disconnect();
    connecting = false;
    render();
  };
  if (client.fresh && latest?.mode === 2)
    void operate("MODE", [0], "待机").finally(finish);
  else finish();
});
["standby", "auto", "manual"].forEach((name, mode) =>
  $("mode-" + name).addEventListener("click", () => {
    void operate("MODE", [mode], modes[mode]);
  }),
);
$("water").addEventListener("click", () => {
  void operate(
    "WATER",
    [Number($<HTMLInputElement>("duration").value)],
    "限时浇水",
  );
});
$("stop").addEventListener("click", () => {
  void operate("STOP", [], "急停");
});
$("reset").addEventListener("click", () => {
  void operate("RESET", [], "复位");
});
$("apply-threshold").addEventListener("click", () => {
  void operate(
    "THRESH",
    [
      Number($<HTMLInputElement>("start-threshold").value),
      Number($<HTMLInputElement>("stop-threshold").value),
    ],
    "阈值设置",
  );
});
$("settings-open").addEventListener("click", () => {
  if (latest) {
    $<HTMLInputElement>("start-threshold").value = String(latest.start);
    $<HTMLInputElement>("stop-threshold").value = String(latest.stop);
  }
  $("dialog-feedback-slot").append(feedback);
  for (const notice of notices) $("dialog-notices").append(notice.element);
  $("settings-close").before(emergency);
  settings.showModal();
});
$("settings-close").addEventListener("click", () => settings.close());
settings.addEventListener("close", () => {
  feedbackAnchor.after(feedback);
  emergencyAnchor.after(emergency);
  for (const notice of notices) notice.anchor.after(notice.element);
  $("settings-open").focus();
});
for (const id of ["history-range", "history-from", "history-to", "soil-scale"])
  $(id).addEventListener("change", () => {
    $("custom-range").classList.toggle(
      "hidden",
      $<HTMLSelectElement>("history-range").value !== "custom",
    );
    void refreshHistory();
  });
$("export").addEventListener("click", async () => {
  try {
    const { from, to } = historyBounds(),
      samples = await storage.query(from, to);
    if (!samples.length) {
      operationMessage = "所选时间没有记录";
      render();
      return;
    }
    const url = URL.createObjectURL(
      new Blob([samplesCsv(samples)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "irrigation-real-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    operationMessage = "已导出 " + samples.length + " 条记录";
    render();
  } catch (error) {
    if (error instanceof RangeError) {
      operationMessage = error.message;
      render();
    } else storageFailure(error);
  }
});
function localDateInput(time: number) {
  return new Date(time - new Date(time).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
$<HTMLInputElement>("history-from").value = localDateInput(
  Date.now() - 86400000,
);
$<HTMLInputElement>("history-to").value = localDateInput(Date.now() + 60000);
window.addEventListener("pagehide", () => client.disconnect());
setInterval(render, 1000);
setInterval(() => {
  if (activeTab === "history") void refreshHistory();
}, 3000);
render();
void refreshHistory();
