import { THRESHOLDS } from "@/lib/constants";
import { holtForecast, linreg } from "@/lib/stats";
import type { EntityStat, ForecastResult, NamedSeries, RegionStat } from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";
import { dailySeries } from "./statistics";

/* ------------------------------------------------------------------------
 * Agent 7 — Forecasting
 * Holt double-exponential-smoothing projections of utilization / traffic
 * with confidence bands and saturation-date estimation.
 * ---------------------------------------------------------------------- */

export interface ForecastOutput {
  forecasts: ForecastResult[];
}

function forecastSeries(
  series: NamedSeries,
  unit: string,
  horizon: number,
  saturationThreshold: number,
  capPct: boolean
): ForecastResult {
  const values = series.points.map((p) => p.v);
  const holt = holtForecast(values, horizon);
  const lastT = series.points[series.points.length - 1].t;
  const z = 1.28; // ~80% band

  const forecast = holt.forecast.map((v, i) => ({
    t: lastT + (i + 1) * DAY_MS,
    v: capPct ? Math.min(100, Math.max(0, v)) : Math.max(0, v),
  }));
  const upper = holt.forecast.map((v, i) => ({
    t: lastT + (i + 1) * DAY_MS,
    v: capPct ? Math.min(100, v + z * holt.residStd * Math.sqrt(i + 1) * 0.45) : v + z * holt.residStd * Math.sqrt(i + 1) * 0.45,
  }));
  const lower = holt.forecast.map((v, i) => ({
    t: lastT + (i + 1) * DAY_MS,
    v: Math.max(0, v - z * holt.residStd * Math.sqrt(i + 1) * 0.45),
  }));

  // saturation: first projected crossing
  let saturationDate: number | null = null;
  if (capPct) {
    const recentMax = Math.max(...values.slice(-5));
    if (recentMax >= saturationThreshold) {
      saturationDate = lastT;
    } else {
      const longHolt = holtForecast(values, THRESHOLDS.saturationLookaheadDays);
      const idx = longHolt.forecast.findIndex((v) => v >= saturationThreshold);
      if (idx >= 0) saturationDate = lastT + (idx + 1) * DAY_MS;
    }
  }

  const lr = linreg(
    series.points.map((_, i) => i),
    values
  );

  return {
    name: series.name,
    unit,
    history: series.points,
    forecast,
    upper,
    lower,
    slopePerDay: lr.slope,
    saturationDate,
    saturationThreshold,
    method: "Holt double exponential smoothing (α=0.45, β=0.25), 80% band",
  };
}

export function computeForecasts(
  frame: Frame,
  regionStats: RegionStat[],
  entityStats: EntityStat[],
  isTelecom: boolean
): ForecastOutput {
  const forecasts: ForecastResult[] = [];
  if (!frame.hasTime) return { forecasts };
  const horizon = THRESHOLDS.forecastHorizonDays;

  const value = isTelecom && frame.util ? frame.util : frame.measure;
  const valueIsPct = isTelecom && !!frame.util;
  if (!value) return { forecasts };

  // Overall daily series — peak (p95-ish via daily mean of busy values) for telecom, mean otherwise
  const overallDaily = dailySeries(frame, value, valueIsPct ? "Network — daily avg utilization" : `${frame.measureName} — daily`, valueIsPct ? "mean" : "sum");
  if (overallDaily && overallDaily.points.length >= 5) {
    forecasts.push(forecastSeries(overallDaily, valueIsPct ? "%" : "raw", horizon, THRESHOLDS.saturation, valueIsPct));
  }

  // Daily PEAK utilization network-wide (capacity planning view)
  if (valueIsPct) {
    const byDay = new Map<number, number>();
    for (let i = 0; i < frame.n; i++) {
      const v = value[i];
      const t = frame.t[i];
      if (v === null || t === null) continue;
      const d = Math.floor((t - frame.timeStart) / DAY_MS);
      const cur = byDay.get(d);
      if (cur === undefined || v > cur) byDay.set(d, v);
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    if (days.length >= 5) {
      const peakSeries: NamedSeries = {
        name: "Network — daily peak utilization",
        points: days.map((d) => ({ t: frame.timeStart + d * DAY_MS, v: byDay.get(d)! })),
      };
      forecasts.push(forecastSeries(peakSeries, "%", horizon, THRESHOLDS.saturation, true));
    }
  }

  // Top-risk regions
  if (valueIsPct && frame.region) {
    const topRegions = regionStats.slice(0, 3);
    for (const rs of topRegions) {
      const byDay = new Map<number, { s: number; c: number }>();
      for (let i = 0; i < frame.n; i++) {
        if (frame.region[i] !== rs.region) continue;
        const v = value[i];
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
      if (days.length >= 5) {
        const s: NamedSeries = {
          name: `${rs.region} — daily avg utilization`,
          points: days.map((d) => ({ t: frame.timeStart + d * DAY_MS, v: byDay.get(d)!.s / byDay.get(d)!.c })),
        };
        forecasts.push(forecastSeries(s, "%", horizon, THRESHOLDS.saturation, true));
      }
    }
  }

  // Traffic forecast (volume planning)
  if (frame.traffic) {
    const trafficDaily = dailySeries(frame, frame.traffic, "Total traffic — daily avg (Mbps)", "mean");
    if (trafficDaily && trafficDaily.points.length >= 5) {
      // scale per-sample mean into fleet-level mean by multiplying entity count
      const entityCount = Math.max(1, frame.entities.length);
      const scaled: NamedSeries = {
        name: "Fleet traffic — avg concurrent (Mbps)",
        points: trafficDaily.points.map((p) => ({ t: p.t, v: p.v * entityCount })),
      };
      forecasts.push(forecastSeries(scaled, "Mbps", horizon, Number.POSITIVE_INFINITY, false));
    }
  }

  return { forecasts };
}
