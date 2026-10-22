const paths = {
  rain: '<path d="M6 15a4 4 0 1 1 1-7 5 5 0 0 1 10-1 4 4 0 0 1 1 8H6Z"/><path d="m8 18-1 3m6-3-1 3m6-3-1 3"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  sensor:
    '<circle cx="12" cy="12" r="3"/><path d="M6 6a8.5 8.5 0 0 0 0 12m12-12a8.5 8.5 0 0 1 0 12M3 3a13 13 0 0 0 0 18M21 3a13 13 0 0 1 0 18"/>',
  water:
    '<path d="M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  temp: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v9m5-10h3m-3 4h2"/>',
  light:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  valve: '<path d="M3 10h5l8 8h5V8h-5l-8 8H3Zm9-5v8M8 5h8"/>',
  history: '<path d="M4 4v16h16M7 14l4-5 4 3 5-7"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="var(--card)"/><circle cx="16" cy="17" r="2" fill="var(--card)"/>',
  stop: '<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5Z"/><path d="M9 9h6v6H9Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export const icon = (name: keyof typeof paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
export const page = `
<div class="shell">
  <header class="topbar">
    <div class="brand"><span class="brand-icon">${icon("chip")}</span><h1>智慧物联网</h1></div>
    <div class="connection" role="status"><span class="dot" id="connection-dot"></span><div><strong id="connection-label">未连接</strong><span id="fresh-label">等待数据</span></div></div>
    <div class="top-actions"><button class="btn primary" id="connect">${icon("bluetooth")}连接设备</button><button class="btn hidden" id="disconnect">断开连接</button><button class="btn" id="settings-open">${icon("settings")}设置</button><button class="btn danger" id="stop" disabled>${icon("stop")}急停</button></div>
  </header>
  <main>
    <div class="tabs" role="tablist" aria-label="工作台页面"><button id="tab-monitor" role="tab" aria-selected="true" aria-controls="monitor">${icon("sensor")}实时监控</button><button id="tab-history" role="tab" aria-selected="false" aria-controls="history" tabindex="-1">${icon("history")}历史记录</button></div>
    <div class="notice hidden" id="faults" role="alert"></div><div class="notice hidden" id="storage-error" role="alert"></div>
    <div class="feedback" id="pending" role="status" aria-live="polite"></div>
    <section id="monitor" role="tabpanel" aria-labelledby="tab-monitor">
      <div class="cards">
        <article class="card"><div class="card-top"><h2>土壤湿度</h2><span class="sensor-icon">${icon("water")}</span></div><div class="reading" id="soil-reading"><strong id="soil-value">—</strong><span>%</span></div><p class="quality" id="soil-quality">等待采集</p></article>
        <article class="card"><div class="card-top"><h2>环境温度</h2><span class="sensor-icon warm">${icon("temp")}</span></div><div class="reading" id="temp-reading"><strong id="temp-value">—</strong><span>°C</span></div><p class="quality" id="temp-quality">等待采集</p></article>
        <article class="card"><div class="card-top"><h2>光照</h2><span class="sensor-icon lime">${icon("light")}</span></div><div class="reading" id="light-reading"><strong id="light-value">—</strong><span id="light-unit">lux</span></div><p class="quality" id="light-quality">等待采集</p></article>
      </div>
      <section class="panel rain-status" id="rain-status" aria-live="polite"><h2>${icon("rain")}雨水探测</h2><strong id="rain-state">等待采集</strong><span id="rain-detail"></span><span id="control-version"></span></section>
      <section class="panel control"><div class="panel-head"><h2>${icon("valve")}灌溉控制</h2><div class="modes" role="group" aria-label="运行模式"><button id="mode-standby" disabled>待机</button><button id="mode-auto" disabled>自动</button><button id="mode-manual" disabled>手动</button></div></div>
        <div class="control-status"><div><span class="label">阀门控制输出</span><strong id="valve-state">—</strong></div><div><span class="label" id="timer-label">运行状态</span><strong id="remaining-state">等待连接</strong></div><button class="btn hidden" id="reset" disabled>排查后复位</button></div>
        <div class="manual hidden" id="manual-controls"><label for="duration">浇水时长</label><div class="duration-input"><input id="duration" type="number" min="1" max="30" step="1" value="5" aria-describedby="duration-help"><span>秒</span></div><span id="duration-help">1～30秒</span><button class="btn primary" id="water" disabled>${icon("water")}开始浇水</button></div>
      </section>
    </section>
    <section id="history" role="tabpanel" aria-labelledby="tab-history" hidden>
      <section class="panel history-panel"><div class="panel-head"><h2>环境趋势</h2><div class="history-actions"><select id="history-range" aria-label="历史时间范围"><option value="0.0833333333">最近5分钟</option><option value="0.25">最近15分钟</option><option value="1" selected>最近1小时</option><option value="6">最近6小时</option><option value="24">最近24小时</option><option value="custom">自定义时间</option></select><button class="btn" id="export">${icon("download")}导出 CSV</button></div></div>
        <div class="custom-range hidden" id="custom-range"><label>开始时间<input id="history-from" type="datetime-local"></label><label>结束时间<input id="history-to" type="datetime-local"></label></div>
        <div class="legend"><span><i></i>土壤湿度 %</span><span><i class="blue"></i>浇水期间</span><label class="soil-scale-control" for="soil-scale">湿度刻度<select id="soil-scale"><option value="20">0～20% · 放大</option><option value="50">0～50%</option><option value="100">0～100% · 完整</option></select></label></div><p class="hint" id="soil-scale-note" aria-live="polite">湿度纵轴 0～20%</p>
        <div class="chart-wrap"><canvas id="soil-chart" role="img" aria-label="土壤湿度与浇水趋势图"></canvas><div class="chart-empty" id="chart-empty">所选时间暂无记录</div></div>
        <div class="subcharts"><div><h3>环境温度 / °C</h3><div class="subchart"><canvas id="temp-chart" role="img" aria-label="温度趋势图"></canvas></div></div><div><h3>估算照度 / lux</h3><div class="subchart"><canvas id="light-chart" role="img" aria-label="光照趋势图"></canvas></div></div></div>
        <p class="history-count" id="history-count">正在读取记录…</p>
      </section>
      <section class="panel event-panel"><div class="panel-head"><h2>运行记录</h2><span class="muted">最近40条</span></div><ul class="events" id="events"></ul></section>
    </section>
  </main>
</div>
<dialog id="settings" aria-labelledby="settings-title">
  <div class="dialog-head"><h2 id="settings-title">设备设置</h2><button class="btn icon-button" id="settings-close" aria-label="关闭设置">${icon("close")}</button></div>
  <div id="dialog-notices"></div>
  <section class="settings-section"><h3>灌溉阈值</h3><div class="threshold-inputs"><label>启动湿度 %<input id="start-threshold" type="number" min="0" max="99" step="1" value="30"></label><label>停止湿度 %<input id="stop-threshold" type="number" min="1" max="100" step="1" value="45"></label><button class="btn primary" id="apply-threshold" disabled>应用</button></div><p class="hint" id="threshold-state">仅关阀时可修改，重启恢复默认值。</p></section>
  <section class="settings-section"><h3>蓝牙连接</h3><div class="fields"><label>服务 UUID<input id="service-uuid" value="ffe0" spellcheck="false"></label><label>数据特征 UUID<input id="characteristic-uuid" value="ffe1" spellcheck="false"></label></div></section>
  <section class="settings-section"><h3>采集诊断</h3><dl class="diagnostics"><div><dt>土壤 ADC</dt><dd id="soil-raw">—</dd></div><div><dt>温度 ADC</dt><dd id="temp-raw">—</dd></div><div><dt>光照 ADC</dt><dd id="light-raw">—</dd></div><div><dt>雨水 ADC</dt><dd id="rain-raw">—</dd></div><div><dt>LED 状态</dt><dd id="led-state">—</dd></div></dl><p class="hint" id="diagnostic">尚未收到设备数据。</p></section>
  <div id="dialog-feedback-slot"></div>
</dialog>`;




