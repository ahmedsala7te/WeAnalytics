/* Statistical toolkit used by the analysis agents. Pure functions only. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: number[]): number {
  return percentile(xs, 50);
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export interface LinReg {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least squares y = a + b*x */
export function linreg(xs: number[], ys: number[]): LinReg {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Pearson correlation coefficient. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return 0;
  return sab / Math.sqrt(saa * sbb);
}

export function movingAverage(xs: number[], window: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i];
    if (i >= window) acc -= xs[i - window];
    out.push(acc / Math.min(i + 1, window));
  }
  return out;
}

export interface HoltResult {
  /** point forecasts for the next `horizon` steps */
  forecast: number[];
  /** standard deviation of one-step-ahead residuals */
  residStd: number;
  /** final trend (per step) */
  trend: number;
  level: number;
}

/**
 * Holt's linear (double exponential smoothing) forecast.
 * Robust default for short telecom capacity series.
 */
export function holtForecast(values: number[], horizon: number, alpha = 0.45, beta = 0.25): HoltResult {
  if (values.length === 0) {
    return { forecast: Array(horizon).fill(0), residStd: 0, trend: 0, level: 0 };
  }
  if (values.length === 1) {
    return { forecast: Array(horizon).fill(values[0]), residStd: 0, trend: 0, level: values[0] };
  }
  let level = values[0];
  let trend = values[1] - values[0];
  const residuals: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const pred = level + trend;
    residuals.push(values[i] - pred);
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) forecast.push(level + trend * h);
  return { forecast, residStd: std(residuals), trend, level };
}

export interface ZAnomaly {
  index: number;
  value: number;
  expected: number;
  z: number;
}

/** Rolling z-score anomaly detection over a series. */
export function rollingAnomalies(values: number[], window = 24, threshold = 3): ZAnomaly[] {
  const out: ZAnomaly[] = [];
  if (values.length < window + 2) return out;
  for (let i = window; i < values.length; i++) {
    const slice = values.slice(i - window, i);
    const m = mean(slice);
    const s = std(slice);
    if (s < 1e-6) continue;
    const z = (values[i] - m) / s;
    if (Math.abs(z) >= threshold) {
      out.push({ index: i, value: values[i], expected: m, z });
    }
  }
  return out;
}

export function histogram(values: number[], binCount = 12): { edges: number[]; counts: number[] } {
  if (values.length === 0) return { edges: [], counts: [] };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return { edges: [lo, hi], counts: [values.length] };
  const width = (hi - lo) / binCount;
  const counts = new Array(binCount).fill(0);
  for (const v of values) {
    let b = Math.floor((v - lo) / width);
    if (b >= binCount) b = binCount - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const edges = Array.from({ length: binCount + 1 }, (_, i) => lo + i * width);
  return { edges, counts };
}

/** Smallest number of top contributors covering >= sharePct of total. */
export function paretoCover(sortedDesc: number[], sharePct: number): { count: number; share: number } {
  const total = sortedDesc.reduce((a, b) => a + b, 0);
  if (total <= 0) return { count: 0, share: 0 };
  let acc = 0;
  for (let i = 0; i < sortedDesc.length; i++) {
    acc += sortedDesc[i];
    if ((acc / total) * 100 >= sharePct) {
      return { count: i + 1, share: (acc / total) * 100 };
    }
  }
  return { count: sortedDesc.length, share: 100 };
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
