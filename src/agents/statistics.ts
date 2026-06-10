import { mean, pearson, rollingAnomalies } from "@/lib/stats";
import { fmtDateTime, fmtNum, titleCase, uid } from "@/lib/format";
import type { Anomaly, CorrelationPair, NamedSeries } from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";

/* ------------------------------------------------------------------------
 * Agent 6 — Statistical Analysis
 * Correlation matrix across measures, anomaly detection on hourly/daily
 * aggregates (traffic spikes, sudden drops, alarm storms).
 * ---------------------------------------------------------------------- */

export interface StatsOutput {
  correlations: CorrelationPair[];
  anomalies: Anomaly[];
}

const METRIC_LABELS: [keyof Frame, string][] = [
  ["util", "Utilization"],
  ["traffic", "Traffic"],
  ["alarms", "Alarms"],
  ["criticalAlarms", "Critical alarms"],
  ["availability", "Availability"],
  ["latency", "Latency"],
  ["packetLoss", "Packet loss"],
  ["subscribers", "Subscribers"],
];

export function computeStatistics(frame: Frame): StatsOutput {
  /* ---------------------------- correlations ---------------------------- */
  const present = METRIC_LABELS.filter(([k]) => Array.isArray(frame[k]) && frame[k] !== null);
  const correlations: CorrelationPair[] = [];
  const sampleIdx: number[] = [];
  const step = Math.max(1, Math.floor(frame.n / 8000));
  for (let i = 0; i < frame.n; i += step) sampleIdx.push(i);

  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const [ka, la] = present[i];
      const [kb, lb] = present[j];
      const colA = frame[ka] as (number | null)[];
      const colB = frame[kb] as (number | null)[];
      const va: number[] = [];
      const vb: number[] = [];
      for (const idx of sampleIdx) {
        const a = colA[idx];
        const b = colB[idx];
        if (a !== null && b !== null) {
          va.push(a);
          vb.push(b);
        }
      }
      if (va.length < 30) continue;
      const r = pearson(va, vb);
      if (Math.abs(r) >= 0.25) {
        correlations.push({
          a: la,
          b: lb,
          r,
          note:
            Math.abs(r) >= 0.7
              ? `Strong ${r > 0 ? "positive" : "negative"} relationship`
              : `Moderate ${r > 0 ? "positive" : "negative"} relationship`,
        });
      }
    }
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  /* ------------------------------ anomalies ----------------------------- */
  const anomalies: Anomaly[] = [];
  if (frame.hasTime) {
    // Hourly aggregate series for the main measure per region
    const regions = frame.regions.length > 0 ? frame.regions : ["All"];
    const useRegions = regions.length <= 24 ? regions : regions.slice(0, 24);
    const value = frame.util ?? frame.measure;
    const metricName = frame.util ? "utilization" : frame.measureName;

    if (value) {
      for (const reg of useRegions) {
        const byHour = new Map<number, { s: number; c: number }>();
        for (let i = 0; i < frame.n; i++) {
          if (frame.region && frame.region[i] !== reg && regions.length > 1) continue;
          const v = value[i];
          const t = frame.t[i];
          if (v === null || t === null) continue;
          const bucket = Math.floor(t / 3600_000);
          const cur = byHour.get(bucket);
          if (cur) {
            cur.s += v;
            cur.c++;
          } else byHour.set(bucket, { s: v, c: 1 });
        }
        const buckets = [...byHour.keys()].sort((a, b) => a - b);
        if (buckets.length < 30) continue;
        const series = buckets.map((b) => byHour.get(b)!.s / byHour.get(b)!.c);
        const found = rollingAnomalies(series, 24, 3.2);
        for (const an of found.slice(-6)) {
          const tMs = buckets[an.index] * 3600_000;
          const kind = an.z > 0 ? "spike" : "drop";
          anomalies.push({
            time: tMs,
            region: reg === "All" ? undefined : reg,
            metric: metricName,
            value: an.value,
            expected: an.expected,
            zScore: an.z,
            kind,
            severity: Math.abs(an.z) >= 5 ? "critical" : "warning",
            text: `${reg !== "All" ? reg + ": " : ""}${titleCase(metricName)} ${kind === "spike" ? "spiked to" : "dropped to"} ${fmtNum(
              an.value
            )} (expected ≈${fmtNum(an.expected)}) at ${fmtDateTime(tMs)} · z=${an.z.toFixed(1)}`,
          });
        }
      }
    }

    // Alarm storms: daily alarm totals
    if (frame.alarms) {
      const byDay = new Map<number, number>();
      for (let i = 0; i < frame.n; i++) {
        const a = frame.alarms[i];
        const t = frame.t[i];
        if (a === null || t === null) continue;
        const d = Math.floor(t / DAY_MS);
        byDay.set(d, (byDay.get(d) ?? 0) + a);
      }
      const days = [...byDay.keys()].sort((a, b) => a - b);
      const series = days.map((d) => byDay.get(d)!);
      if (series.length >= 7) {
        const m = mean(series);
        for (let i = 0; i < series.length; i++) {
          if (m > 0 && series[i] > m * 2.2 && series[i] > 20) {
            const tMs = days[i] * DAY_MS;
            anomalies.push({
              time: tMs,
              metric: "alarms",
              value: series[i],
              expected: m,
              zScore: (series[i] - m) / Math.max(1, m),
              kind: "alarm_storm",
              severity: series[i] > m * 3.5 ? "critical" : "warning",
              text: `Alarm storm: ${fmtNum(series[i], 0)} alarms in one day vs ${fmtNum(m, 0)}/day normal baseline (${(
                series[i] / m
              ).toFixed(1)}×)`,
            });
          }
        }
      }
    }
  }

  // keep the most diagnostic anomalies (storms > drops > spikes), then re-sort by recency
  const weight = (a: Anomaly) =>
    (a.kind === "alarm_storm" ? 30 : a.kind === "drop" ? 20 : 10) + (a.severity === "critical" ? 5 : 0);
  const kept = [...anomalies].sort((a, b) => weight(b) - weight(a) || b.time - a.time).slice(0, 16);
  kept.sort((a, b) => b.time - a.time);
  return {
    correlations: correlations.slice(0, 10),
    anomalies: kept,
  };
}

/* Helper reused by chat/forecast: daily aggregate of a metric */
export function dailySeries(frame: Frame, col: (number | null)[] | null, name: string, agg: "mean" | "sum" = "mean"): NamedSeries | null {
  if (!col || !frame.hasTime) return null;
  const byDay = new Map<number, { s: number; c: number }>();
  for (let i = 0; i < frame.n; i++) {
    const v = col[i];
    const t = frame.t[i];
    if (v === null || t === null) continue;
    const d = Math.floor((t - frame.timeStart) / DAY_MS);
    const cur = byDay.get(d);
    if (cur) {
      cur.s += v;
      cur.c++;
    } else byDay.set(d, { s: v, c: 1 });
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length < 3) return null;
  return {
    name,
    points: days.map((d) => {
      const { s, c } = byDay.get(d)!;
      return { t: frame.timeStart + d * DAY_MS, v: agg === "mean" ? s / c : s };
    }),
  };
}

export const _id = uid;
