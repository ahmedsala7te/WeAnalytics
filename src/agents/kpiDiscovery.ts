import { THRESHOLDS } from "@/lib/constants";
import { titleCase } from "@/lib/format";
import { clamp, linreg, mean, percentile } from "@/lib/stats";
import type { CongestionEvent, EntityStat, Kpi, KpiStatus, RegionStat } from "@/lib/types";
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

export function discoverKpis(
  frame: Frame,
  entityStats: EntityStat[],
  regionStats: RegionStat[],
  events: CongestionEvent[],
  healthScore: number,
  isTelecom: boolean,
  higherIsBad = false
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
    /* ------------------------- Generic dataset KPIs ------------------------- */
    const measure = frame.measure;
    const label = titleCase(frame.measureName);
    const goodDir: Kpi["goodWhen"] = higherIsBad ? "low" : "high";
    if (measure) {
      const vals = measure.filter((x): x is number => x !== null);
      const total = vals.reduce((a, b) => a + b, 0);
      if (daily && daily.days.length >= 2) {
        const wm = splitWindows(daily.measureSum);
        const cur = wm.cur.reduce((a, b) => a + b, 0);
        const prev = wm.prev.length ? wm.prev.reduce((a, b) => a + b, 0) : null;
        const worse = prev !== null && (higherIsBad ? cur > prev * 1.1 : cur < prev * 0.9);
        add({
          name: `${label} (current vs prior)`,
          category: "generic",
          value: cur,
          unit: "raw",
          previous: prev,
          changePct: change(cur, prev),
          goodWhen: goodDir,
          status: worse ? "warning" : "healthy",
          spark: daily.measureSum,
          description: `Total ${label} in the current window vs the prior one.`,
          formula: `sum(${frame.measureName})`,
        });
        const lr = linreg(daily.days, daily.measureSum);
        const growth = mean(daily.measureSum) > 0 ? ((lr.slope * 7) / mean(daily.measureSum)) * 100 : 0;
        add({
          name: higherIsBad ? "Degradation Trend" : "Growth Rate",
          category: "generic",
          value: growth,
          unit: "pct/wk",
          previous: null,
          changePct: null,
          goodWhen: goodDir,
          status: higherIsBad ? (growth > 5 ? "critical" : growth > 0 ? "warning" : "healthy") : growth >= 0 ? "healthy" : "warning",
          spark: daily.measureSum,
          description: `Week-over-week trend of ${label}.`,
          formula: "OLS slope × 7 ÷ mean",
        });
      }
      add({
        name: `${label} (total)`,
        category: "generic",
        value: total,
        unit: "raw",
        previous: null,
        changePct: null,
        goodWhen: goodDir,
        status: "healthy",
        spark: daily ? daily.measureSum : [],
        description: `Sum of ${label} across the dataset.`,
        formula: `sum(${frame.measureName})`,
      });
      add({
        name: `${label} (avg per ${frame.entities.length > 1 ? "element" : "record"})`,
        category: "generic",
        value: mean(vals),
        unit: "raw",
        previous: null,
        changePct: null,
        goodWhen: "neutral",
        status: "healthy",
        spark: daily ? daily.measureSum : [],
        description: `Mean ${label} per ${frame.entities.length > 1 ? "element" : "record"}.`,
        formula: `mean(${frame.measureName})`,
      });
      if (higherIsBad && entityStats.length > 1) {
        const worst = entityStats[0];
        add({
          name: "Worst Element Share",
          category: "generic",
          value: total > 0 ? (worst.avgUtil * (frame.n / Math.max(1, entityStats.length)) / total) * 100 : 0,
          unit: "%",
          previous: null,
          changePct: null,
          goodWhen: "low",
          status: "watch",
          spark: [],
          description: `Share of total ${label} carried by the single worst element (${worst.entity}).`,
          formula: "worst entity mean × records ÷ total",
        });
      }
    }
    if (frame.subscribers) {
      const subsByEntity = new Map<string, number>();
      for (let i = 0; i < frame.n; i++) {
        const s = frame.subscribers[i];
        const ent = frame.entity ? frame.entity[i] : String(i);
        if (s !== null && s !== undefined && (subsByEntity.get(ent) ?? 0) < s) subsByEntity.set(ent, s);
      }
      const totalSubs = [...subsByEntity.values()].reduce((a, b) => a + b, 0);
      add({
        name: "Subscribers Affected",
        category: "generic",
        value: totalSubs,
        unit: "count",
        previous: null,
        changePct: null,
        goodWhen: "low",
        status: totalSubs > 20000 ? "warning" : "watch",
        spark: [],
        description: "Total subscribers homed on the elements in this report.",
        formula: "sum(max subscribers per element)",
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
      spark: daily ? daily.measureSum : [],
      description: "Rows ingested into the analysis.",
      formula: "count(rows)",
    });
    if (frame.entities.length > 1) {
      add({
        name: "Tracked Entities",
        category: "generic",
        value: frame.entities.length,
        unit: "count",
        previous: null,
        changePct: null,
        goodWhen: "neutral",
        status: "healthy",
        spark: [],
        description: "Distinct entities discovered in the dataset.",
        formula: "distinct(entity column)",
      });
    }
  }

  return kpis;
}
