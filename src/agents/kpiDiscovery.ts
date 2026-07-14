import { THRESHOLDS } from "@/lib/constants";
import { titleCase } from "@/lib/format";
import { clamp, linreg, mean, percentile } from "@/lib/stats";
import type { CongestionEvent, EntityStat, Kpi, KpiStatus, RegionStat, TelecomBusinessContext } from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";

/* ------------------------------------------------------------------------
 * Agent 4 — KPI Discovery
 * Automatically derives the KPI catalog from the available semantics:
 * current value, prior-window comparison, sparkline and health status.
 * ---------------------------------------------------------------------- */

interface DailyAgg {
  days: number[];
  avgUtil: number[];
  peakUtil: number[];
  traffic: number[];
  alarms: number[];
  criticals: number[];
  availability: number[];
  latency: number[];
  loss: number[];
  measureSum: number[];
  events: number[];
  congestedEntities: number[];
}

function buildDaily(frame: Frame, events: CongestionEvent[], isTelecom: boolean): DailyAgg | null {
  if (!frame.hasTime) return null;
  const value = isTelecom && frame.util ? frame.util : frame.measure;
  const byDay = new Map<
    number,
    { s: number; c: number; peak: number; tr: number; trc: number; al: number; cr: number; av: number; avc: number; la: number; lac: number; lo: number; loc: number; ms: number }
  >();
  for (let i = 0; i < frame.n; i++) {
    const t = frame.t[i];
    if (t === null) continue;
    // exclude grand-total / aggregate rows so daily sums reflect real members
    if (frame.aggregateMask && frame.aggregateMask[i]) continue;
    const d = Math.floor((t - frame.timeStart) / DAY_MS);
    let cur = byDay.get(d);
    if (!cur) {
      cur = { s: 0, c: 0, peak: -Infinity, tr: 0, trc: 0, al: 0, cr: 0, av: 0, avc: 0, la: 0, lac: 0, lo: 0, loc: 0, ms: 0 };
      byDay.set(d, cur);
    }
    const v = value ? value[i] : null;
    if (v !== null && v !== undefined) {
      cur.s += v;
      cur.c++;
      if (v > cur.peak) cur.peak = v;
      cur.ms += v;
    }
    const tr = frame.traffic ? frame.traffic[i] : null;
    if (tr !== null && tr !== undefined) {
      cur.tr += tr;
      cur.trc++;
    }
    const al = frame.alarms ? frame.alarms[i] : null;
    if (al !== null && al !== undefined) cur.al += al;
    const cr = frame.criticalAlarms ? frame.criticalAlarms[i] : null;
    if (cr !== null && cr !== undefined) cur.cr += cr;
    const av = frame.availability ? frame.availability[i] : null;
    if (av !== null && av !== undefined) {
      cur.av += av;
      cur.avc++;
    }
    const la = frame.latency ? frame.latency[i] : null;
    if (la !== null && la !== undefined) {
      cur.la += la;
      cur.lac++;
    }
    const lo = frame.packetLoss ? frame.packetLoss[i] : null;
    if (lo !== null && lo !== undefined) {
      cur.lo += lo;
      cur.loc++;
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length === 0) return null;

  const evByDay = new Map<number, number>();
  const congEntByDay = new Map<number, Set<string>>();
  for (const e of events) {
    const d = Math.floor((e.time - frame.timeStart) / DAY_MS);
    evByDay.set(d, (evByDay.get(d) ?? 0) + 1);
    let s = congEntByDay.get(d);
    if (!s) {
      s = new Set();
      congEntByDay.set(d, s);
    }
    s.add(e.entity);
  }

  return {
    days,
    avgUtil: days.map((d) => {
      const c = byDay.get(d)!;
      return c.c ? c.s / c.c : 0;
    }),
    peakUtil: days.map((d) => {
      const c = byDay.get(d)!;
      return Number.isFinite(c.peak) ? c.peak : 0;
    }),
    traffic: days.map((d) => {
      const c = byDay.get(d)!;
      return c.trc ? c.tr / c.trc : 0;
    }),
    alarms: days.map((d) => byDay.get(d)!.al),
    criticals: days.map((d) => byDay.get(d)!.cr),
    availability: days.map((d) => {
      const c = byDay.get(d)!;
      return c.avc ? c.av / c.avc : 0;
    }),
    latency: days.map((d) => {
      const c = byDay.get(d)!;
      return c.lac ? c.la / c.lac : 0;
    }),
    loss: days.map((d) => {
      const c = byDay.get(d)!;
      return c.loc ? c.lo / c.loc : 0;
    }),
    measureSum: days.map((d) => byDay.get(d)!.ms),
    events: days.map((d) => evByDay.get(d) ?? 0),
    congestedEntities: days.map((d) => congEntByDay.get(d)?.size ?? 0),
  };
}

/**
 * Per-day total of a column that is robust to grand-total ("active") rows:
 * each day's total = max( sum of real-member rows, largest aggregate-row value ).
 * This gives the right answer whether the listed members fully cover the total
 * (volume) or only partially (subscribers with unlisted tiers).
 */
function dailyTotals(frame: Frame, col: (number | null)[]): { days: number[]; totals: number[] } {
  const real = new Map<number, number>();
  const agg = new Map<number, number>();
  for (let i = 0; i < frame.n; i++) {
    const t = frame.t[i];
    const v = col[i];
    if (t === null || v === null || v === undefined) continue;
    const d = Math.floor((t - frame.timeStart) / DAY_MS);
    if (frame.aggregateMask && frame.aggregateMask[i]) {
      agg.set(d, Math.max(agg.get(d) ?? 0, v));
    } else {
      real.set(d, (real.get(d) ?? 0) + v);
    }
  }
  const days = [...new Set([...real.keys(), ...agg.keys()])].sort((a, b) => a - b);
  return { days, totals: days.map((d) => Math.max(real.get(d) ?? 0, agg.get(d) ?? 0)) };
}

function splitWindows<T>(arr: T[]): { cur: T[]; prev: T[] } {
  const w = Math.min(7, Math.max(1, Math.floor(arr.length / 2)));
  return { cur: arr.slice(-w), prev: arr.slice(-2 * w, -w) };
}

function change(cur: number, prev: number | null): number | null {
  if (prev === null || !Number.isFinite(prev) || Math.abs(prev) < 1e-9) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function statusOf(value: number, bands: [number, number, number], goodWhen: "low" | "high"): KpiStatus {
  const [a, b, c] = bands;
  if (goodWhen === "high") {
    if (value >= a) return "healthy";
    if (value >= b) return "watch";
    if (value >= c) return "warning";
    return "critical";
  }
  if (value <= a) return "healthy";
  if (value <= b) return "watch";
  if (value <= c) return "warning";
  return "critical";
}

type AddKpi = (k: Omit<Kpi, "id">) => void;

function changeStatus(changePct: number | null, higherIsBad: boolean): KpiStatus {
  if (changePct === null || Math.abs(changePct) < 2) return "healthy";
  if (higherIsBad) {
    if (changePct >= 25) return "critical";
    if (changePct > 0) return "warning";
    return "healthy";
  }
  if (changePct <= -25) return "critical";
  if (changePct < 0) return "warning";
  return "healthy";
}

function entityDailyDeltas(frame: Frame, higherIsBad: boolean): {
  rows: { entity: string; latest: number; previous: number; delta: number; deltaPct: number | null; subscribers: number }[];
  worsening: { entity: string; latest: number; previous: number; delta: number; deltaPct: number | null; subscribers: number }[];
} {
  if (!frame.measure || !frame.hasTime || !frame.entity) return { rows: [], worsening: [] };
  const byEntity = new Map<string, Map<number, number>>();
  for (let i = 0; i < frame.n; i++) {
    const t = frame.t[i];
    const v = frame.measure[i];
    if (t === null || v === null || v === undefined) continue;
    if (frame.aggregateMask && frame.aggregateMask[i]) continue;
    const day = Math.floor((t - frame.timeStart) / DAY_MS);
    const entity = frame.entity[i];
    let byDay = byEntity.get(entity);
    if (!byDay) {
      byDay = new Map();
      byEntity.set(entity, byDay);
    }
    byDay.set(day, (byDay.get(day) ?? 0) + v);
  }
  const rows = [...byEntity.entries()]
    .map(([entity, byDay]) => {
      const days = [...byDay.keys()].sort((a, b) => a - b);
      const latest = byDay.get(days[days.length - 1]) ?? 0;
      const previous = byDay.get(days[days.length - 2]) ?? 0;
      const subs = frame.subscribers && frame.entity
        ? maxSubscriberForEntity(frame, entity)
        : 0;
      return { entity, latest, previous, delta: latest - previous, deltaPct: change(latest, previous), subscribers: subs };
    })
    .sort((a, b) => (higherIsBad ? b.delta - a.delta || b.latest - a.latest : a.delta - b.delta || b.latest - a.latest));
  const worsening = rows.filter((r) => (higherIsBad ? r.delta > 0 : r.delta < 0));
  return { rows, worsening };
}

function maxSubscriberForEntity(frame: Frame, entity: string): number {
  if (!frame.subscribers || !frame.entity) return 0;
  let max = 0;
  for (let i = 0; i < frame.n; i++) {
    if (frame.entity[i] !== entity) continue;
    const v = frame.subscribers[i];
    if (v !== null && v !== undefined && v > max) max = v;
  }
  return max;
}

function addCriticalTimeKpis(add: AddKpi, frame: Frame, higherIsBad: boolean, businessContext: TelecomBusinessContext): void {
  const businessCaseIds = [businessContext.selectedCaseId];
  if (!frame.measure) return;
  const label = titleCase(frame.measureName);
  const dt = dailyTotals(frame, frame.measure);
  if (dt.totals.length === 0) return;
  const latest = dt.totals[dt.totals.length - 1];
  const previous = dt.totals.length >= 2 ? dt.totals[dt.totals.length - 2] : null;
  const latestChange = change(latest, previous);
  add({
    name: "Latest Critical Time",
    category: "assurance",
    businessCaseIds,
    businessPriority: 10,
    value: latest,
    unit: "raw",
    previous,
    changePct: latestChange,
    goodWhen: "low",
    status: changeStatus(latestChange, true),
    spark: dt.totals,
    description: `Latest-day total for ${label}, the main operational measure for this report.`,
    formula: `Σ ${frame.measureName} on latest day`,
  });

  if (frame.warningMeasure && frame.warningMeasureName && frame.warningMeasureName !== frame.measureName) {
    const wt = dailyTotals(frame, frame.warningMeasure);
    if (wt.totals.length > 0) {
      const warningLatest = wt.totals[wt.totals.length - 1];
      const warningPrev = wt.totals.length >= 2 ? wt.totals[wt.totals.length - 2] : null;
      const warningChange = change(warningLatest, warningPrev);
      add({
        name: "Latest Warning Time",
        category: "assurance",
        businessCaseIds,
        businessPriority: 9,
        value: warningLatest,
        unit: "raw",
        previous: warningPrev,
        changePct: warningChange,
        goodWhen: "low",
        status: changeStatus(warningChange, true),
        spark: wt.totals,
        description: `Latest-day total for ${titleCase(frame.warningMeasureName)}.`,
        formula: `Σ ${frame.warningMeasureName} on latest day`,
      });
    }
  }

  const deltas = entityDailyDeltas(frame, higherIsBad);
  add({
    name: "Worsening MSANs",
    category: "assurance",
    businessCaseIds,
    businessPriority: 8,
    value: deltas.worsening.length,
    unit: "count",
    previous: null,
    changePct: null,
    goodWhen: "low",
    status: deltas.worsening.length > 10 ? "critical" : deltas.worsening.length > 0 ? "warning" : "healthy",
    spark: [],
    description: "Number of elements whose latest critical-time value increased versus the previous day.",
    formula: "count(entity where latest critical time > previous day)",
  });
  const worst = [...deltas.rows].sort((a, b) => b.latest - a.latest)[0];
  if (worst) {
    add({
      name: "Worst MSAN Latest",
      category: "assurance",
      businessCaseIds,
      businessPriority: 7,
      value: worst.latest,
      unit: "raw",
      previous: worst.previous,
      changePct: worst.deltaPct,
      goodWhen: "low",
      status: changeStatus(worst.deltaPct, true),
      spark: [],
      description: `${worst.entity} has the highest latest-day critical-time value.`,
      formula: "max latest-day critical time by entity",
    });
  }
  const impacted = deltas.worsening.reduce((s, r) => s + r.subscribers, 0);
  if (impacted > 0) {
    add({
      name: "Subscribers on Worsening MSANs",
      category: "assurance",
      businessCaseIds,
      businessPriority: 6,
      value: impacted,
      unit: "count",
      previous: null,
      changePct: null,
      goodWhen: "low",
      status: impacted > 50_000 ? "critical" : impacted > 0 ? "warning" : "healthy",
      spark: [],
      description: "Subscriber base attached to elements whose critical time worsened versus the previous day.",
      formula: "Σ subscribers where latest critical time > previous day",
    });
  }
}

function addBusinessKpis(add: AddKpi, frame: Frame, higherIsBad: boolean, businessContext?: TelecomBusinessContext): void {
  if (!businessContext) return;
  if (businessContext.selectedCaseId === "critical_time_comparison") {
    addCriticalTimeKpis(add, frame, higherIsBad, businessContext);
  }
}

function tagBusinessKpiPack(kpis: Kpi[], businessContext?: TelecomBusinessContext): void {
  if (!businessContext) return;
  const packs: Record<string, string[]> = {
    critical_time_comparison: ["Latest Critical Time", "Latest Warning Time", "Worsening MSANs", "Worst MSAN Latest", "Subscribers on Worsening MSANs"],
    subscriber_impact: ["Total Subscribers", "Largest Segment", "Subscriber Impact", "Segments Tracked", "Tracked Entities"],
    upgrade_followup: ["Records Analyzed", "Tracked Entities", "Total Subscribers", "Segments Tracked"],
    congestion_risk: ["Congestion Events", "Chronic Congestion Points", "Peak Utilization", "Average Utilization", "Capacity Risk Index"],
    capacity_upgrade: ["Capacity Headroom", "Saturating ≤60 Days", "Capacity Risk Index", "Traffic Growth Rate", "Chronic Congestion Points"],
    alarm_assurance: ["Alarm Volume", "Critical Alarms", "Service Availability", "Records Analyzed"],
    availability_degradation: ["Service Availability", "SLA Compliance", "Subscriber Impact", "Degradation Trend"],
    region_performance: ["Average Utilization", "Peak Utilization", "Regional Health", "Records Analyzed"],
    top_offenders: ["Worst Element Share", "Tracked Entities", "Records Analyzed", "Degradation Trend"],
    daily_exception: ["Records Analyzed", "Tracked Entities", "Degradation Trend", "Latest Critical Time"],
  };
  const names = packs[businessContext.selectedCaseId] ?? [];
  names.forEach((name, index) => {
    const kpi = kpis.find((k) => k.name === name);
    if (!kpi) return;
    kpi.businessCaseIds = [...new Set([...(kpi.businessCaseIds ?? []), businessContext.selectedCaseId])];
    kpi.businessPriority = Math.max(kpi.businessPriority ?? 0, names.length - index);
  });
}

export function discoverKpis(
  frame: Frame,
  entityStats: EntityStat[],
  regionStats: RegionStat[],
  events: CongestionEvent[],
  healthScore: number,
  isTelecom: boolean,
  higherIsBad = false,
  businessContext?: TelecomBusinessContext
): Kpi[] {
  const kpis: Kpi[] = [];
  const daily = buildDaily(frame, events, isTelecom);
  const valueIsPct = isTelecom && !!frame.util;

  const add = (k: Omit<Kpi, "id">) => kpis.push({ id: k.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...k });

  if (valueIsPct && daily) {
    const w = splitWindows(daily.avgUtil);
    const wPeak = splitWindows(daily.peakUtil);
    const wEvents = splitWindows(daily.events);
    const wCong = splitWindows(daily.congestedEntities);

    const healthSpark = daily.avgUtil.map((u, i) =>
      clamp(100 - (clamp((u - 52) * 0.5, 0, 15) + (daily.congestedEntities[i] / Math.max(1, entityStats.length)) * 45), 5, 99.5)
    );
    add({
      name: "Network Health Score",
      category: "executive",
      value: healthScore,
      unit: "score",
      previous: healthSpark.length > 7 ? mean(healthSpark.slice(-14, -7)) : null,
      changePct: healthSpark.length > 7 ? change(healthScore, mean(healthSpark.slice(-14, -7))) : null,
      goodWhen: "high",
      status: statusOf(healthScore, [90, 75, 60], "high"),
      spark: healthSpark,
      description: "Composite 0–100 score combining utilization pressure, congestion spread, chronic points, alarms and availability.",
      formula: "100 − (util pressure + congestion share×26 + chronic share×24 + alarm rate + availability penalty)",
    });

    const avgUtil = mean(w.cur);
    add({
      name: "Average Utilization",
      category: "performance",
      value: avgUtil,
      unit: "%",
      previous: w.prev.length ? mean(w.prev) : null,
      changePct: change(avgUtil, w.prev.length ? mean(w.prev) : null),
      goodWhen: "low",
      status: statusOf(avgUtil, [65, 75, 85], "low"),
      spark: daily.avgUtil,
      description: "Mean utilization across all monitored elements in the current window.",
      formula: "mean(utilization) over trailing 7 days",
    });

    const peak = Math.max(...wPeak.cur);
    add({
      name: "Peak Utilization",
      category: "performance",
      value: peak,
      unit: "%",
      previous: wPeak.prev.length ? Math.max(...wPeak.prev) : null,
      changePct: change(peak, wPeak.prev.length ? Math.max(...wPeak.prev) : null),
      goodWhen: "low",
      status: statusOf(peak, [80, 90, 95], "low"),
      spark: daily.peakUtil,
      description: "Highest single-element utilization observed in the current window.",
      formula: "max(utilization) over trailing 7 days",
    });

    // Busy hour
    const hourAvg: number[] = [];
    if (frame.util) {
      const hs = new Array(24).fill(0);
      const hc = new Array(24).fill(0);
      for (let i = 0; i < frame.n; i++) {
        const t = frame.t[i];
        const v = frame.util[i];
        if (t === null || v === null) continue;
        const h = new Date(t).getHours();
        hs[h] += v;
        hc[h]++;
      }
      for (let h = 0; h < 24; h++) hourAvg.push(hc[h] ? hs[h] / hc[h] : 0);
    }
    const busyHour = hourAvg.indexOf(Math.max(...hourAvg));
    if (hourAvg.some((x) => x > 0)) {
      add({
        name: "Busy-Hour Utilization",
        category: "performance",
        value: hourAvg[busyHour],
        unit: "%",
        previous: null,
        changePct: null,
        goodWhen: "low",
        status: statusOf(hourAvg[busyHour], [70, 82, 92], "low"),
        spark: hourAvg,
        description: `Average utilization during the network busy hour (${String(busyHour).padStart(2, "0")}:00).`,
        formula: "mean(utilization | hour = argmax hourly avg)",
      });
    }

    const evCur = wEvents.cur.reduce((a, b) => a + b, 0);
    const evPrev = wEvents.prev.length ? wEvents.prev.reduce((a, b) => a + b, 0) : null;
    add({
      name: "Congestion Events",
      category: "performance",
      value: evCur,
      unit: "count",
      previous: evPrev,
      changePct: change(evCur, evPrev),
      goodWhen: "low",
      status: evCur === 0 ? "healthy" : statusOf(evCur / Math.max(1, entityStats.length), [0.5, 2, 6], "low"),
      spark: daily.events,
      description: `Element-hours at ≥${THRESHOLDS.utilizationCongested}% utilization in the trailing 7 days.`,
      formula: `count(samples ≥ ${THRESHOLDS.utilizationCongested}%)`,
    });

    const chronicCount = entityStats.filter((e) => e.chronic).length;
    add({
      name: "Chronic Congestion Points",
      category: "capacity",
      value: chronicCount,
      unit: "count",
      previous: null,
      changePct: null,
      goodWhen: "low",
      status: chronicCount === 0 ? "healthy" : chronicCount <= 3 ? "watch" : chronicCount <= 8 ? "warning" : "critical",
      spark: daily.congestedEntities,
      description: `Elements congested on ≥${THRESHOLDS.chronicMinDays} days within the last ${THRESHOLDS.chronicWindowDays} days — structural capacity gaps.`,
      formula: `count(entities with congested days ≥ ${THRESHOLDS.chronicMinDays} in ${THRESHOLDS.chronicWindowDays}d window)`,
    });

    const headroom = 100 - percentile(entityStats.map((e) => e.p95Util), 80);
    add({
      name: "Capacity Headroom",
      category: "capacity",
      value: headroom,
      unit: "%",
      previous: null,
      changePct: null,
      goodWhen: "high",
      status: statusOf(headroom, [25, 15, 8], "high"),
      spark: daily.peakUtil.map((p) => 100 - p),
      description: "Remaining capacity buffer at the 80th percentile of element p95 utilization.",
      formula: "100 − p80(entity p95 utilization)",
    });

    // Growth
    const lrTraffic = daily.traffic.some((x) => x > 0)
      ? linreg(daily.days, daily.traffic)
      : linreg(daily.days, daily.avgUtil);
    const base = daily.traffic.some((x) => x > 0) ? mean(daily.traffic) : mean(daily.avgUtil);
    const growthWk = base > 0 ? ((lrTraffic.slope * 7) / base) * 100 : 0;
    add({
      name: "Traffic Growth Rate",
      category: "capacity",
      value: growthWk,
      unit: "pct/wk",
      previous: null,
      changePct: null,
      goodWhen: "neutral",
      status: growthWk <= 1 ? "healthy" : growthWk <= 2 ? "watch" : growthWk <= 3.2 ? "warning" : "critical",
      spark: daily.traffic.some((x) => x > 0) ? daily.traffic : daily.avgUtil,
      description: "Week-over-week organic growth of carried traffic (linear regression on daily averages).",
      formula: "OLS slope(daily traffic) × 7 ÷ mean(daily traffic)",
    });

    if (frame.availability && daily.availability.some((x) => x > 0)) {
      const wa = splitWindows(daily.availability.filter((x) => x > 0));
      const avail = mean(wa.cur);
      add({
        name: "Service Availability",
        category: "assurance",
        value: avail,
        unit: "%",
        previous: wa.prev.length ? mean(wa.prev) : null,
        changePct: change(avail, wa.prev.length ? mean(wa.prev) : null),
        goodWhen: "high",
        status: statusOf(avail, [99.9, 99.5, 99.0], "high"),
        spark: daily.availability,
        description: "Mean element availability across the trailing window.",
        formula: "mean(availability%)",
      });

      const slaShare =
        (regionStats.filter((r) => (r.availability ?? 100) >= THRESHOLDS.slaAvailabilityTarget).length /
          Math.max(1, regionStats.length)) *
        100;
      add({
        name: "SLA Compliance",
        category: "assurance",
        value: slaShare,
        unit: "%",
        previous: null,
        changePct: null,
        goodWhen: "high",
        status: statusOf(slaShare, [95, 85, 70], "high"),
        spark: daily.availability,
        description: `Share of regions meeting the ${THRESHOLDS.slaAvailabilityTarget}% availability target.`,
        formula: `share(regions with availability ≥ ${THRESHOLDS.slaAvailabilityTarget}%)`,
      });
    }

    if (frame.alarms && daily.alarms.some((x) => x > 0)) {
      const walarm = splitWindows(daily.alarms);
      const alarmCur = walarm.cur.reduce((a, b) => a + b, 0);
      const alarmPrev = walarm.prev.length ? walarm.prev.reduce((a, b) => a + b, 0) : null;
      add({
        name: "Alarm Volume",
        category: "assurance",
        value: alarmCur,
        unit: "count",
        previous: alarmPrev,
        changePct: change(alarmCur, alarmPrev),
        goodWhen: "low",
        status:
          alarmPrev === null
            ? "watch"
            : alarmCur <= alarmPrev * 1.1
              ? "healthy"
              : alarmCur <= alarmPrev * 1.5
                ? "warning"
                : "critical",
        spark: daily.alarms,
        description: "Total alarms raised in the trailing 7 days.",
        formula: "sum(alarms) trailing 7d",
      });
    }
    if (frame.criticalAlarms && daily.criticals.some((x) => x > 0)) {
      const wc = splitWindows(daily.criticals);
      const cur = wc.cur.reduce((a, b) => a + b, 0);
      const prev = wc.prev.length ? wc.prev.reduce((a, b) => a + b, 0) : null;
      add({
        name: "Critical Alarms",
        category: "assurance",
        value: cur,
        unit: "count",
        previous: prev,
        changePct: change(cur, prev),
        goodWhen: "low",
        status: cur === 0 ? "healthy" : prev !== null && cur > prev * 1.5 ? "critical" : "warning",
        spark: daily.criticals,
        description: "Critical-severity alarms in the trailing 7 days.",
        formula: "sum(critical alarms) trailing 7d",
      });
    }

    const subsImpacted = entityStats.filter((e) => e.chronic || e.congestedHours > 0).reduce((s, e) => s + (e.subscribers ?? 0), 0);
    if (frame.subscribers) {
      add({
        name: "Subscriber Impact",
        category: "executive",
        value: subsImpacted,
        unit: "count",
        previous: null,
        changePct: null,
        goodWhen: "low",
        status: subsImpacted === 0 ? "healthy" : subsImpacted < 5000 ? "watch" : subsImpacted < 25000 ? "warning" : "critical",
        spark: daily.congestedEntities,
        description: "Subscribers homed on elements that experienced congestion in the analysis window.",
        formula: "sum(subscribers | entity congested)",
      });
    }

    const riskIdx = mean(entityStats.slice(0, Math.max(5, Math.floor(entityStats.length * 0.1))).map((e) => e.riskScore));
    add({
      name: "Capacity Risk Index",
      category: "executive",
      value: riskIdx,
      unit: "score",
      previous: null,
      changePct: null,
      goodWhen: "low",
      status: statusOf(riskIdx, [35, 55, 75], "low"),
      spark: daily.peakUtil,
      description: "Mean risk score of the top decile of elements (utilization, growth, congestion and alarms blended).",
      formula: "mean(risk score of top-10% entities)",
    });

    const saturating = entityStats.filter((e) => e.saturationDate !== null && e.saturationDate <= Date.now() + 60 * DAY_MS).length;
    add({
      name: "Saturating ≤60 Days",
      category: "capacity",
      value: saturating,
      unit: "count",
      previous: null,
      changePct: null,
      goodWhen: "low",
      status: saturating === 0 ? "healthy" : saturating <= 3 ? "watch" : saturating <= 10 ? "warning" : "critical",
      spark: daily.peakUtil,
      description: `Elements forecast to exceed ${THRESHOLDS.saturation}% utilization within 60 days at current growth.`,
      formula: "count(entities with Holt forecast crossing ≥95% in 60d)",
    });

    if (frame.latency && daily.latency.some((x) => x > 0)) {
      const wl = splitWindows(daily.latency.filter((x) => x > 0));
      const lat = mean(wl.cur);
      add({
        name: "Average Latency",
        category: "performance",
        value: lat,
        unit: "ms",
        previous: wl.prev.length ? mean(wl.prev) : null,
        changePct: change(lat, wl.prev.length ? mean(wl.prev) : null),
        goodWhen: "low",
        status: statusOf(lat, [15, 25, 40], "low"),
        spark: daily.latency,
        description: "Mean access latency across elements.",
        formula: "mean(latency ms)",
      });
    }
    if (frame.packetLoss && daily.loss.some((x) => x > 0)) {
      const wl = splitWindows(daily.loss);
      const loss = mean(wl.cur);
      add({
        name: "Packet Loss",
        category: "performance",
        value: loss,
        unit: "%",
        previous: wl.prev.length ? mean(wl.prev) : null,
        changePct: change(loss, wl.prev.length ? mean(wl.prev) : null),
        goodWhen: "low",
        status: statusOf(loss, [0.1, 0.5, 1.5], "low"),
        spark: daily.loss,
        description: "Mean packet loss across elements.",
        formula: "mean(packet loss %)",
      });
    }
  } else {
    /* ------------- Breakdown / measure-mode KPIs (stock + flow aware) -------- */
    const measure = frame.measure;
    const label = titleCase(frame.measureName);
    const isFlow = frame.measureKind === "flow";
    const goodDir: Kpi["goodWhen"] = higherIsBad ? "low" : "high";

    // primary measure daily totals (aggregate-aware: "active"/total rows excluded)
    const dt = measure ? dailyTotals(frame, measure) : { days: [], totals: [] };
    const hasDailyMeasure = dt.totals.length >= 1;
    addBusinessKpis(add, frame, higherIsBad, businessContext);

    /* --- Subscribers (a stock): lead with the real base, not a sum-over-days --- */
    let subsLatest = 0;
    if (frame.subscribers) {
      const ds = dailyTotals(frame, frame.subscribers);
      if (ds.totals.length >= 1) {
        subsLatest = ds.totals[ds.totals.length - 1];
        const ws = splitWindows(ds.totals);
        const prevSubs = ws.prev.length ? mean(ws.prev) : null;
        add({
          name: "Total Subscribers",
          category: "executive",
          value: subsLatest,
          unit: "count",
          previous: prevSubs,
          changePct: change(subsLatest, prevSubs),
          goodWhen: "high",
          status: "healthy",
          spark: ds.totals,
          description: "Active subscriber base on the most recent day (point-in-time count, not summed across days).",
          formula: "latest day total subscribers (aggregate-aware)",
        });
        if (ds.days.length >= 3) {
          const lr = linreg(ds.days, ds.totals);
          const g = mean(ds.totals) > 0 ? ((lr.slope * 7) / mean(ds.totals)) * 100 : 0;
          add({
            name: "Subscriber Growth",
            category: "executive",
            value: g,
            unit: "pct/wk",
            previous: null,
            changePct: null,
            goodWhen: "high",
            status: g >= 0 ? "healthy" : "warning",
            spark: ds.totals,
            description: "Week-over-week trend of the subscriber base.",
            formula: "OLS slope(daily subscribers) × 7 ÷ mean",
          });
        }
      }
    }

    /* --- Primary measure headline --- */
    if (measure && hasDailyMeasure) {
      const latest = dt.totals[dt.totals.length - 1];
      const windowSum = dt.totals.reduce((a, b) => a + b, 0);
      const avgDaily = mean(dt.totals);
      const wm = splitWindows(dt.totals);
      const curAgg = isFlow ? wm.cur.reduce((a, b) => a + b, 0) : mean(wm.cur);
      const prevAgg = wm.prev.length ? (isFlow ? wm.prev.reduce((a, b) => a + b, 0) : mean(wm.prev)) : null;

      if (isFlow && frame.hasTime) {
        add({
          name: `${label} (latest day)`,
          category: "generic",
          value: latest,
          unit: "raw",
          previous: dt.totals.length >= 2 ? dt.totals[dt.totals.length - 2] : null,
          changePct: dt.totals.length >= 2 ? change(latest, dt.totals[dt.totals.length - 2]) : null,
          goodWhen: goodDir,
          status: "healthy",
          spark: dt.totals,
          description: `Total ${label} on the most recent day across all segments.`,
          formula: `Σ ${frame.measureName} on latest day`,
        });
      } else {
        const worse = prevAgg !== null && (higherIsBad ? curAgg > prevAgg * 1.1 : curAgg < prevAgg * 0.9);
        add({
          name: `${label} (current vs prior)`,
          category: "generic",
          value: curAgg,
          unit: "raw",
          previous: prevAgg,
          changePct: change(curAgg, prevAgg),
          goodWhen: goodDir,
          status: worse ? "warning" : "healthy",
          spark: dt.totals,
          description: `${label} in the current window vs the prior one.`,
          formula: isFlow ? `sum(${frame.measureName})` : `mean(${frame.measureName})`,
        });
      }

      // data-per-subscriber ratio (flow ÷ subscriber base)
      if (isFlow && subsLatest > 0) {
        const tib = /tib|tebibyte/i.test(frame.measureName) || /\btb\b|terabyte/i.test(frame.measureName);
        const perSub = (latest / subsLatest) * (tib ? 1024 : 1);
        add({
          name: tib ? "Data per Subscriber (GB/day)" : `${label} per Subscriber`,
          category: "executive",
          value: perSub,
          unit: "raw",
          previous: null,
          changePct: null,
          goodWhen: "neutral",
          status: "healthy",
          spark: dt.totals,
          description: `Average ${label} per active subscriber on the latest day${tib ? ", converted to GB" : ""}.`,
          formula: `latest ${frame.measureName} ÷ subscribers${tib ? " × 1024" : ""}`,
        });
      }

      if (dt.days.length >= 3) {
        const lr = linreg(dt.days, dt.totals);
        const growth = avgDaily > 0 ? ((lr.slope * 7) / avgDaily) * 100 : 0;
        add({
          name: higherIsBad ? "Degradation Trend" : `${label} Growth`,
          category: "generic",
          value: growth,
          unit: "pct/wk",
          previous: null,
          changePct: null,
          goodWhen: goodDir,
          status: higherIsBad ? (growth > 5 ? "critical" : growth > 0 ? "warning" : "healthy") : growth >= 0 ? "healthy" : "warning",
          spark: dt.totals,
          description: `Week-over-week trend of ${label}.`,
          formula: "OLS slope × 7 ÷ mean",
        });
      }

      add({
        name: isFlow ? `${label} (window total)` : `${label} (average)`,
        category: "generic",
        value: isFlow ? windowSum : avgDaily,
        unit: "raw",
        previous: null,
        changePct: null,
        goodWhen: goodDir,
        status: "healthy",
        spark: dt.totals,
        description: isFlow ? `Total ${label} across the whole window.` : `Average daily ${label}.`,
        formula: isFlow ? `Σ daily ${frame.measureName}` : `mean(daily ${frame.measureName})`,
      });
    }

    /* --- Segment mix: largest category --- */
    if (entityStats.length > 1) {
      const bySubs = frame.subscribers ? [...entityStats].filter((e) => (e.subscribers ?? 0) > 0).sort((a, b) => (b.subscribers ?? 0) - (a.subscribers ?? 0)) : [];
      if (bySubs.length > 1) {
        const totalS = bySubs.reduce((s, e) => s + (e.subscribers ?? 0), 0);
        const top = bySubs[0];
        add({
          name: "Largest Segment",
          category: "executive",
          value: totalS > 0 ? ((top.subscribers ?? 0) / totalS) * 100 : 0,
          unit: "%",
          previous: null,
          changePct: null,
          goodWhen: "neutral",
          status: "watch",
          spark: [],
          description: `${top.entity} holds the largest share of subscribers among the ${bySubs.length} segments.`,
          formula: "top segment subscribers ÷ total",
        });
      } else if (higherIsBad) {
        const worst = entityStats[0];
        add({
          name: "Worst Element Share",
          category: "generic",
          value: hasDailyMeasure ? Math.min(100, ((worst.avgUtil * (frame.n / Math.max(1, entityStats.length))) / Math.max(1, dt.totals.reduce((a, b) => a + b, 0))) * 100) : 0,
          unit: "%",
          previous: null,
          changePct: null,
          goodWhen: "low",
          status: "watch",
          spark: [],
          description: `Share of total ${label} from the single worst element (${worst.entity}).`,
          formula: "worst entity mean × records ÷ total",
        });
      }
      add({
        name: frame.subscribers ? "Segments Tracked" : "Tracked Entities",
        category: "generic",
        value: frame.entities.length,
        unit: "count",
        previous: null,
        changePct: null,
        goodWhen: "neutral",
        status: "healthy",
        spark: [],
        description: "Distinct categories discovered in the breakdown dimension.",
        formula: "distinct(entity column)",
      });
    }

    add({
      name: "Records Analyzed",
      category: "generic",
      value: frame.n,
      unit: "count",
      previous: null,
      changePct: null,
      goodWhen: "neutral",
      status: "healthy",
      spark: hasDailyMeasure ? dt.totals : [],
      description: "Rows ingested into the analysis.",
      formula: "count(rows)",
    });
  }

  tagBusinessKpiPack(kpis, businessContext);
  return kpis;
}
