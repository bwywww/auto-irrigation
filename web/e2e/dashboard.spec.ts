import { test, expect, type Page } from "@playwright/test";
import { installBle } from "./ble-fixture";
test.beforeEach(async ({ page }) => {
  await installBle(page);
});
async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(page.locator("#connection-label")).toHaveText("HC-08 Test");
  await expect(page.locator("#mode-manual")).toBeEnabled();
}
test("real entry supports timed watering, settings, STOP and reset without a demo UI", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await connect(page);
  await expect(
    page.getByText(/体验|演示|模拟干燥|GARDEN OVERVIEW/),
  ).toHaveCount(0);
  await expect(page.locator("#history-source")).toHaveCount(0);
  await expect(page.locator("#manual-controls")).toBeHidden();
  await page.locator("#mode-manual").click();
  await page.locator("#duration").fill("31");
  await page.locator("#water").click();
  await expect(page.locator("#pending")).toHaveText("命令参数无效");
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await page.locator("#duration").fill("2");
  await expect(page.locator("#soil-value")).toHaveText("36");
  await page.locator("#water").click();
  await expect(page.locator("#valve-state")).toHaveText("开启");
  await expect(page.locator("#soil-value")).toHaveText("36");
  await expect(page.locator("#valve-state")).toHaveText("关闭", {
    timeout: 5000,
  });
  await expect(page.locator("#soil-value")).toHaveText("36");
  await page.locator("#settings-open").click();
  await expect(page.locator("#soil-raw")).toHaveText("651");
  await page.locator("#start-threshold").fill("35");
  await page.locator("#stop-threshold").fill("35");
  await page.locator("#apply-threshold").click();
  await expect(page.locator("#pending")).toHaveText("命令参数无效");
  await page.locator("#stop-threshold").fill("55");
  await page.locator("#apply-threshold").click();
  await expect(page.locator("#threshold-state")).toContainText(
    "35% 启动 / 55% 停止",
  );
  await expect(page.locator("#pending")).toContainText("设备已确认");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-open")).toBeFocused();
  await page.locator("#duration").fill("20");
  await page.locator("#water").click();
  await expect(page.locator("#valve-state")).toHaveText("开启");
  await page.locator("#settings-open").click();
  await expect(page.locator("#apply-threshold")).toBeDisabled();
  await page.locator("#stop").click();
  await expect(page.locator("#pending")).toContainText("急停：设备已确认");
  await expect(page.locator("#settings #faults")).toContainText("急停");
  await page.locator("#settings-close").click();
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await expect(page.locator("#faults")).toContainText("急停");
  await page.locator("#reset").click();
  await expect(page.locator("#faults")).toBeHidden();
  await expect(page.locator("#mode-standby")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
test("tabs retain heartbeat and data, persist real history and exclude legacy samples from export", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("smart-irrigation-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(["samples", "events"], "readwrite");
        tx.objectStore("samples").add({
          source: "demo",
          session: "old",
          receivedAt: Date.now(),
          device: "legacy simulator",
          data: {},
        });
        tx.objectStore("events").add({
          source: "demo",
          session: "old",
          receivedAt: Date.now(),
          message: "legacy demo event",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    localStorage.setItem("irrigation-history-source", "demo");
  });
  const heartbeats = await page.evaluate(
    () => window.bleTest.writes.filter((s) => s.endsWith(",HB")).length,
  );
  await page.locator("#tab-history").click();
  await expect(page.locator("#history-count")).toContainText(/[1-9].*条记录/);
  const initialCount = parseInt(
    (await page.locator("#history-count").innerText()).replaceAll(",", ""),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => window.bleTest.writes.filter((s) => s.endsWith(",HB")).length,
      ),
    )
    .toBeGreaterThan(heartbeats + 1);
  await expect
    .poll(async () =>
      parseInt(
        (await page.locator("#history-count").innerText()).replaceAll(",", ""),
      ),
    )
    .toBeGreaterThan(initialCount);
  await expect(page.locator("#events")).not.toContainText("legacy");
  const downloaded = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain("irrigation-real-");
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString("utf8");
  expect(csv).toContain('"real"');
  expect(csv).not.toContain("demo");
  expect(csv).not.toContain("legacy");
  await page.reload();
  await page.locator("#tab-history").click();
  await expect(page.locator("#history-count")).toContainText(/[1-9].*条记录/);
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#events")).not.toContainText("legacy");
});
test("soil chart magnifies low readings while marking real outliers", async ({ page }) => {
  await connect(page);
  await page.evaluate(() => window.bleTest.patch({ soil: 14 }));
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("smart-irrigation-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("samples", "readwrite");
        const store = tx.objectStore("samples");
        const rows = store.getAll();
        rows.onsuccess = () => {
          const base = rows.result.at(-1);
          store.clear(); // isolated Playwright database: replace initial fixture readings
          for (let i = 0; i < 120; i++) {
            const { id, ...sample } = base;
            store.add({ ...sample, receivedAt: Date.now() - (120 - i) * 1000,
              data: { ...base.data, soil: i === 40 ? 100 : i >= 60 && i < 90 ? 3 : 14,
                valve: i >= 60 && i < 90 } });
          }
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.locator("#tab-history").click();
  await page.locator("#history-range").selectOption("0.0833333333");
  await expect(page.locator("#soil-scale")).toHaveValue("20");
  await expect(page.locator("#soil-scale-note")).toContainText("1 条记录超出刻度");
  await page.screenshot({ path: "test-results/soil-zoom.png", fullPage: true });
  await page.locator("#soil-scale").selectOption("100");
  await expect(page.locator("#soil-scale-note")).toContainText("纵轴 0～100%");
  await expect(page.locator("#soil-scale-note")).not.toContainText("超出");
  await page.locator("#soil-scale").selectOption("50");
  await expect(page.locator("#soil-scale-note")).toContainText("纵轴 0～50%");
  await page.locator("#tab-monitor").click();
  await page.locator("#tab-history").click();
  await expect(page.locator("#soil-scale")).toHaveValue("50");
});

test("rain stops manual and automatic output, blocks restart and preserves settings diagnostics", async ({ page }) => {
  await connect(page);
  await page.locator("#mode-manual").click();
  await page.locator("#duration").fill("30");
  await page.locator("#water").click();
  await expect(page.locator("#valve-state")).toHaveText("开启");
  await page.evaluate(() => window.bleTest.patch({ rainRaw: 600, rainState: 2 }));
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await expect(page.locator("#rain-state")).toHaveText("下雨");
  await expect(page.locator("#water")).toBeDisabled();
  await expect(page.locator("#mode-auto")).toBeDisabled();
  await page.locator("#settings-open").click();
  await expect(page.locator("#rain-raw")).toHaveText("600");
  await page.locator("#settings-close").click();
  await page.locator("#stop").click();
  await page.locator("#reset").click();
  await expect(page.locator("#pending")).toContainText("未通过");
  await page.evaluate(() => window.bleTest.patch({ rainRaw: 0, rainState: 3, rainRemaining: 60000 }));
  await expect(page.locator("#rain-detail")).toContainText("60秒");
  await expect(page.locator("#mode-auto")).toBeDisabled();
  await page.evaluate(() => window.bleTest.patch({ rainState: 1, rainRemaining: 0 }));
  await expect(page.locator("#rain-state")).toHaveText("未下雨");
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await page.locator("#reset").click();
  await page.locator("#mode-auto").click();
  await page.evaluate(() => window.bleTest.patch({ mode: 1, valve: 1, rainState: 2 }));
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await page.evaluate(() => window.bleTest.patch({ rainState: 4 }));
  await expect(page.locator("#rain-state")).toHaveText("采样异常");
  await page.evaluate(() => window.bleTest.patch({ rainState: 0 }));
  await expect(page.locator("#rain-state")).toHaveText("待校准");
  await page.screenshot({ path: "test-results/rain-uncalibrated.png", fullPage: true });
  await page.locator("#tab-history").click();
  await expect(page.locator("#events")).toContainText("雨水状态");
});

test("automatic watering, soil fault and three good readings before reset", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(() => window.bleTest.patch({ soil: 22 }));
  await page.locator("#mode-auto").click();
  await expect(page.locator("#valve-state")).toHaveText("开启");
  await page.evaluate(() => window.bleTest.patch({ soil: 60 }));
  await expect(page.locator("#valve-state")).toHaveText("关闭");
  await expect(page.locator("#timer-label")).toHaveText("自动冷却");
  await page.evaluate(() => window.bleTest.probe(false));
  await expect(page.locator("#faults")).toContainText("土壤", {
    timeout: 5000,
  });
  await page.evaluate(() => window.bleTest.probe(true));
  await page.locator("#reset").click();
  await expect(page.locator("#pending")).toContainText("未通过");
  await page.waitForTimeout(3100);
  await page.locator("#reset").click();
  await expect(page.locator("#faults")).toBeHidden();
});
test("STOP on the history tab cancels an unacknowledged command", async ({
  page,
}) => {
  await connect(page);
  await page.locator("#mode-manual").click();
  await page.evaluate(() => window.bleTest.silent("WATER"));
  await page.locator("#water").click();
  await expect(page.locator("#pending")).toContainText("等待设备确认");
  await page.locator("#tab-history").click();
  await page.locator("#stop").click();
  await expect(page.locator("#pending")).toHaveText("急停：设备已确认");
  await expect(page.locator("#faults")).toContainText("急停");
  await page.waitForTimeout(2200);
  expect(
    await page.evaluate(
      () => window.bleTest.writes.filter((s) => s.includes(",WATER,")).length,
    ),
  ).toBe(1);
});
test("stale data disables watering but STOP remains usable; reconnect does not replay controls", async ({
  page,
}) => {
  await connect(page);
  await page.locator("#mode-manual").click();
  await page.evaluate(() => window.bleTest.pause(true));
  await expect(page.locator("#fresh-label")).toHaveText("数据已过期", {
    timeout: 7000,
  });
  await expect(page.locator("#water")).toBeDisabled();
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();
  await expect(page.locator("#pending")).toContainText("急停：设备已确认");
  await page.evaluate(() => {
    window.bleTest.pause(false);
    window.bleTest.disconnect();
  });
  await expect(page.locator("#valve-state")).toHaveText("未知 · 已失联");
  for (let i = 0; i < 10; i++) {
    const before = await page.evaluate(() => window.bleTest.writes.length);
    await page.locator("#connect").click();
    await expect(page.locator("#connection-label")).toHaveText("HC-08 Test");
    expect(
      await page.evaluate(
        (offset) =>
          window.bleTest.writes
            .slice(offset)
            .every((s) => s.endsWith(",HB") || s.endsWith(",STATUS")),
        before,
      ),
    ).toBe(true);
    await page.evaluate(() => window.bleTest.disconnect());
    await expect(page.locator("#connection-label")).toHaveText("未连接");
  }
});
test("uncalibrated soil blocks actuators while light uses lux; storage denial cannot block STOP", async ({
  page,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException("Storage denied", "SecurityError");
    };
  });
  await connect(page);
  await expect(page.locator("#storage-error")).toBeVisible();
  await page.evaluate(() =>
    window.bleTest.patch({
      soil: -1,
      temp: -32768,
      light: -1,
      valid: 0,
      faults: 64,
    }),
  );
  await expect(page.locator("#soil-quality")).toHaveText("待校准");
  await expect(page.locator("#temp-value")).toHaveText("—");
  await expect(page.locator("#light-unit")).toHaveText("lux");
  await expect(page.locator("#light-value")).toHaveText("175.7");
  await expect(page.locator("#mode-auto")).toBeDisabled();
  await page.evaluate(() =>
    window.bleTest.patch({
      soil: 36,
      temp: 2640,
      light: 67,
      valid: 7,
      faults: 0,
    }),
  );
  await page.locator("#mode-manual").click();
  await page.locator("#water").click();
  await expect(page.locator("#valve-state")).toHaveText("开启");
  await page.locator("#tab-history").click();
  await page.locator("#stop").click();
  await expect(page.locator("#faults")).toContainText("急停");
});
for (const width of [1440, 1024, 390])
  test("layout and keyboard access at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connect(page);
    await expect(page.locator("#monitor")).not.toContainText("ADC");
    await expect(page.locator("#light-value")).toHaveText("175.7");
    await page.evaluate(() => window.bleTest.patch({ lightRaw: 1017 }));
    await expect(page.locator("#light-value")).toHaveText("168524.6");
    expect(await page.locator("#light-reading").evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.evaluate(() => window.bleTest.patch({ lightRaw: 1023, faults: 32 }));
    await expect(page.locator("#light-value")).toHaveText("—");
    await page.evaluate(() => window.bleTest.patch({ lightRaw: 650, faults: 0 }));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/monitor-" + width + ".png",
      fullPage: true,
    });
    await page.locator("#tab-monitor").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-history")).toBeFocused();
    await expect(page.locator("#history")).toBeVisible();
    await page.locator("#history-range").selectOption("custom");
    await page.locator("#history-from").fill("2020-01-01T00:00");
    await page.locator("#history-to").fill("2020-01-02T00:00");
    await expect(page.locator("#history-count")).toHaveText("0 条记录");
    await page.locator("#history-from").fill("2020-01-03T00:00");
    await expect(page.locator("#history-count")).toContainText("有效");
    await page.locator("#history-range").selectOption("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/history-" + width + ".png",
      fullPage: true,
    });
    await page.locator("#settings-open").click();
    await expect(page.locator("#settings")).toBeVisible();
    await expect(page.locator("#light-raw")).toHaveText("650");
    expect(
      await page
        .locator("#settings")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: "test-results/settings-" + width + ".png" });
    await page.keyboard.press("Escape");
    await expect(page.locator("#settings-open")).toBeFocused();
  });

test("V3 daylight, soak status, legacy notice and concise diagnostics", async ({page}) => {
 await connect(page);
 await expect(page.locator("#control-version")).toContainText("旧控制版本");
 await page.evaluate(() => window.bleTest.patch({version:3,daylight:1,mode:1,active:1,planned:0}));
 await expect(page.locator("#light-quality")).toContainText("白天");
 await expect(page.locator("#control-version")).toHaveText("");
 await page.evaluate(() => window.bleTest.patch({active:0}));
 await page.locator("#mode-manual").click();
 await page.locator("#water").click();
 await expect(page.locator("#valve-state")).toHaveText("开启");
 await page.evaluate(() => window.bleTest.patch({mode:1,active:1,planned:5000}));
 await expect(page.locator("#timer-label")).toContainText("浇水中");
 await page.evaluate(() => window.bleTest.patch({rainState:2,active:0,planned:0}));
 await expect(page.locator("#valve-state")).toHaveText("关闭");
 await page.evaluate(() => window.bleTest.patch({rainState:1,active:1,daylight:2}));
 await expect(page.locator("#timer-label")).toHaveText("等待渗透");
 await expect(page.locator("#light-quality")).toContainText("晚上");
 await page.screenshot({path:"test-results/v3-soak.png",fullPage:true});
 await page.locator("#settings-open").click();
 await expect(page.getByText("雨水 ADC",{exact:true})).toBeVisible();
 await expect(page.getByText(/土壤湿度按|RAIN_CONFIGURED|雨水 ADC（A3）/)).toHaveCount(0);
});
