import type { Telemetry } from "./protocol";

// Supplied approximate formula; V1's light field remains a percentage.
// Derive lux from raw ADC for both live frames and existing stored history.
export function estimatedLux(t: Pick<Telemetry, "lightRaw" | "faults">): number | null {
  const raw = t.lightRaw;
  if (t.faults & 32 || !Number.isInteger(raw) || raw < 0 || raw >= 1023)
    return null;
  const lux = Math.pow((18 * raw) / (1023 - raw), 1.5);
  return Number.isFinite(lux) ? Math.round(lux * 10) / 10 : null;
}
