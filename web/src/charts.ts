import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Filler,
  type ChartConfiguration,
} from "chart.js";
import type { Sample } from "./storage";
import { estimatedLux } from "./measurements";
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Filler,
);
type Point = { x: number; y: number | null; actualY?: number };
export function wateringIntervals(samples: Sample[]): { from: number; to: number }[] {
  const intervals: { from: number; to: number }[] = [];
  let from: number | null = null;
  let previous: Sample | undefined;
  for (const s of samples) {
    // Do not infer output state across disconnections or missing telemetry.
    if (previous && (previous.session !== s.session || s.receivedAt - previous.receivedAt > 3500)) {
      if (from !== null) intervals.push({ from, to: previous.receivedAt });
      from = null;
    }
    if (s.data.valve) from ??= s.receivedAt;
    else if (from !== null) {
      intervals.push({ from, to: s.receivedAt });
      from = null;
    }
    previous = s;
  }
  if (from !== null && previous) intervals.push({ from, to: previous.receivedAt });
  return intervals;
}
export function points(
  samples: Sample[],
  value: (s: Sample) => number | null,
): Point[] {
  const result: Point[] = [],
    stride = Math.max(1, Math.ceil(samples.length / 400));
  // Keep each bucket's extremes, so short dips/spikes survive downsampling.
  const extremes = new Set<number>();
  for (let start = 0; start < samples.length; start += stride) {
    let min = Infinity, max = -Infinity, minAt = start, maxAt = start;
    for (let i = start; i < Math.min(start + stride, samples.length); i++) {
      const y = value(samples[i]);
      if (y === null) continue;
      if (y < min) { min = y; minAt = i; }
      if (y > max) { max = y; maxAt = i; }
    }
    extremes.add(minAt); extremes.add(maxAt);
  }
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i],
      prev = samples[i - 1];
    const gap =
      prev &&
      (prev.session !== s.session || s.receivedAt - prev.receivedAt > 3500);
    if (gap) result.push({ x: s.receivedAt - 1, y: null });
    if (
      i % stride === 0 ||
      extremes.has(i) ||
      gap ||
      i === samples.length - 1 ||
      value(s) === null
    )
      result.push({ x: s.receivedAt, y: value(s) });
  }
  return result;
}
export function soilScale(samples: Sample[], upper: number) {
  const max = [20, 50, 100].includes(upper) ? upper : 20;
  const count = samples.filter(s => s.data.soil !== null && s.data.soil > max).length;
  const markers: Point[] = points(samples, s => s.data.soil)
    .filter(p => p.y !== null && p.y > max)
    .map(p => ({ x: p.x, y: max, actualY: p.y! }));
  return { max, count, markers };
}
export class HistoryCharts {
  private watering: ReturnType<typeof wateringIntervals> = [];
  private soil: Chart<"line", Point[]>;
  private temperature: Chart<"line", Point[]>;
  private light: Chart<"line", Point[]>;
  constructor(
    soil: HTMLCanvasElement,
    temperature: HTMLCanvasElement,
    light: HTMLCanvasElement,
  ) {
    this.soil = this.create(soil, "相对土壤湿度 %", "#237655", 0, 20, true);
    this.temperature = this.create(temperature, "温度 ℃", "#c28b4b");
    this.light = this.create(light, "估算照度 lux", "#839949", 0);
    this.soil.data.datasets.push({
      label: "超出湿度刻度",
      data: [],
      pointBackgroundColor: "#b46535",
      borderColor: "#b46535",
      pointStyle: "triangle",
      pointRadius: 5,
      pointHitRadius: 10,
      showLine: false,
      clip: false,
    });
  }
  private create(
    canvas: HTMLCanvasElement,
    label: string,
    color: string,
    min?: number,
    max?: number,
    showWatering = false,
  ) {
    const config: ChartConfiguration<"line", Point[]> = {
      type: "line",
      plugins: showWatering ? [{
        id: "watering-background",
        beforeDraw: ({ ctx, chartArea, scales }) => {
          if (!chartArea || !scales.x) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
          ctx.clip();
          ctx.fillStyle = "rgba(55, 143, 202, 0.20)";
          for (const interval of this.watering) {
            const left = scales.x.getPixelForValue(interval.from);
            const right = scales.x.getPixelForValue(interval.to);
            // A single observed ON sample remains visible as a narrow band.
            ctx.fillRect(left, chartArea.top, Math.max(1, right - left), chartArea.height);
          }
          ctx.restore();
        },
      }] : [],
      data: {
        datasets: [
          {
            label,
            data: [],
            borderColor: color,
            backgroundColor: `${color}15`,
            borderWidth: 2,
            pointRadius: (context) =>
              context.dataset.data.length === 1 ? 3 : 0,
            pointHitRadius: 8,
            fill: true,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) =>
                new Date(items[0].parsed.x!).toLocaleTimeString("zh-CN"),
              label: (item) => {
                const raw = item.raw as Point;
                return raw.actualY === undefined
                  ? `${item.dataset.label}: ${item.formattedValue}`
                  : `实际湿度 ${raw.actualY}%（超出当前刻度）`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            grid: { display: false },
            ticks: {
              maxTicksLimit: 5,
              color: "#7b887d",
              callback: function (value) {
                const span = this.max - this.min;
                return new Date(Number(value)).toLocaleString("zh-CN", {
                  month: span >= 86400000 ? "2-digit" : undefined,
                  day: span >= 86400000 ? "2-digit" : undefined,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: span < 120000 ? "2-digit" : undefined,
                });
              },
            },
          },
          y: {
            min,
            max,
            border: { display: false },
            grid: { color: "#edf0e9" },
            ticks: { maxTicksLimit: 5, color: "#7b887d" },
          },
        },
      },
    };
    return new Chart(canvas, config);
  }
  update(samples: Sample[], soilUpper = 20) {
    // A lone timestamp needs a small explicit range; automatic numeric padding
    // otherwise spans months and a zero-radius single point becomes invisible.
    const first = samples[0]?.receivedAt,
      last = samples.at(-1)?.receivedAt;
    for (const chart of [this.soil, this.temperature, this.light]) {
      const x = chart.options.scales!.x!;
      x.min =
        first === undefined
          ? Date.now() - 3600000
          : first === last
            ? first - 1000
            : first;
      x.max =
        last === undefined ? Date.now() : first === last ? last + 1000 : last;
    }
    const scale = soilScale(samples, soilUpper);
    this.soil.options.scales!.y!.max = scale.max;
    this.soil.data.datasets[0].data = points(samples, (s) => s.data.soil);
    this.soil.data.datasets[1].data = scale.markers;
    this.watering = wateringIntervals(samples);
    this.temperature.data.datasets[0].data = points(
      samples,
      (s) => s.data.temperature,
    );
    this.light.data.datasets[0].data = points(samples, (s) => estimatedLux(s.data));
    this.soil.update("none");
    this.temperature.update("none");
    this.light.update("none");
    return scale;
  }
}
