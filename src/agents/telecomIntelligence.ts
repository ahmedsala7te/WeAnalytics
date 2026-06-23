import { THRESHOLDS } from "@/lib/constants";
import { clamp, holtForecast, linreg, mean, percentile } from "@/lib/stats";
import type {
  CongestionEvent,
  EntityStat,
  HeatmapData,
  NamedSeries,
  RegionStat,
  SankeyData,
  SemanticMapping,
} from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";

/* ------------------------------------------------------------------------
 * Agent 5 — Telecom Intelligence
 * Congestion / chronic congestion / saturation / regional health engine.
 * Works on any dataset exposing a utilization-like measure; falls back to
 * the primary measure for generic datasets.
 * ---------------------------------------------------------------------- */

export interface IntelligenceOutput {
  entityStats: EntityStat[];
  regionStats: RegionStat[];
  congestionEvents: CongestionEvent[];
  busyHourProfile: (number | null)[];
  heatmap: HeatmapData | null;
  dailyTrend: { overall: NamedSeries; byRegion: NamedSeries[]; traffic?: NamedSeries } | null;
  healthScore: number;
  sankey: SankeyData | null;
  distribution: { bins: string[]; counts: number[]; metric: string } | null;
  topEntityDaily: NamedSeries[];
}

interface EntityAccumulator {
  region: string;
  technology?: string;
  vendor?: string;
  utils: number[];
  capacity: number;
  subscribers: number;
  traffic: number[];
  alarms: number;
  criticals: number;
  dailyPeak: Map<number, number>;
  congestedHours: number;
  congestedDayset: Set<number>;
}

export function computeIntelligence(frame: Frame, mapping: SemanticMapping, isTelecom: boolean): IntelligenceOutput {
  const { n, t, util, entity, region } = frame;
  const value = isTelecom && util ? util : frame.measure;
  const valueIsPct = isTelecom && !!util;
  const congThresh = THRESHOLDS.utilizationCongested;
  const critThresh = THRESHOLDS.utilizationCritical;

  /* ------------------------- per-entity accumulation ------------------------ */
  const acc = new Map<string, EntityAccumulator>();
  const events: CongestionEvent[] = [];
  const hourSum = new Array(24).fill(0);
  const hourCount = new Array(24).fill(0);

  const regionHourSum = new Map<string, number[]>();
  const regionHourCount = new Map<string, number[]>();
  const dayOverall = new Map<number, { s: number; c: number }>();
  const dayRegion = new Map<string, Map<number, { s: number; c: number }>>();
  const dayTraffic = new Map<number, { s: number; hours: Set<number> }>();

  const start = frame.timeStart;

  for (let i = 0; i < n; i++) {
    const v = value ? value[i] : null;
    if (v === null) continue;
    // skip grand-total / aggregate rows ("active", "total"…) — they would
    // dwarf every real category in the breakdown
    if (frame.aggregateMask && frame.aggregateMask[i]) continue;
    const ent = entity ? entity[i] : "All elements";
    const reg = region ? region[i] : "All regions";
    const time = t[i];

    let a = acc.get(ent);
    if (!a) {
      a = {
        region: reg,
        technology: frame.technology ? frame.technology[i] : undefined,
        vendor: frame.vendor ? frame.vendor[i] : undefined,
        utils: [],
        capacity: 0,
        subscribers: 0,
        traffic: [],
        alarms: 0,
        criticals: 0,
        dailyPeak: new Map(),
        congestedHours: 0,
        congestedDayset: new Set(),
      };
      acc.set(ent, a);
    }
    a.utils.push(v);
    const cap = frame.capacity ? frame.capacity[i] : null;
    if (cap !== null && cap !== undefined && cap > a.capacity) a.capacity = cap;
    const subs = frame.subscribers ? frame.subscribers[i] : null;
    if (subs !== null && subs !== undefined && subs > a.subscribers) a.subscribers = subs;
    const tr = frame.traffic ? frame.traffic[i] : null;
    if (tr !== null && tr !== undefined) a.traffic.push(tr);
    const al = frame.alarms ? frame.alarms[i] : null;
    if (al !== null && al !== undefined) a.alarms += al;
    const cr = frame.criticalAlarms ? frame.criticalAlarms[i] : null;
    if (cr !== null && cr !== undefined) a.criticals += cr;

    if (time !== null) {
      const day = Math.floor((time - start) / DAY_MS);
      const hour = new Date(time).getHours();
      const peak = a.dailyPeak.get(day);
      if (peak === undefined || v > peak) a.dailyPeak.set(day, v);

      hourSum[hour] += v;
      hourCount[hour]++;

      let rh = regionHourSum.get(reg);
      if (!rh) {
        rh = new Array(24).fill(0);
        regionHourSum.set(reg, rh);
        regionHourCount.set(reg, new Array(24).fill(0));
      }
      rh[hour] += v;
      regionHourCount.get(reg)![hour]++;

      const dOv = dayOverall.get(day);
      if (dOv) {
        dOv.s += v;
        dOv.c++;
      } else dayOverall.set(day, { s: v, c: 1 });

      let dr = dayRegion.get(reg);
      if (!dr) {
        dr = new Map();
        dayRegion.set(reg, dr);
      }
      const drv = dr.get(day);
      if (drv) {
        drv.s += v;
        drv.c++;
      } else dr.set(day, { s: v, c: 1 });

      if (tr !== null && tr !== undefined) {
        const dt = dayTraffic.get(day);
        if (dt) {
          dt.s += tr;
          dt.hours.add(hour);
        } else dayTraffic.set(day, { s: tr, hours: new Set([hour]) });
      }

      if (valueIsPct && v >= congThresh) {
        a.congestedHours++;
        a.congestedDayset.add(day);
        if (events.length < 25_000) {
          events.push({
            entity: ent,
            region: reg,
            time,
            utilization: v,
            severity: v >= critThresh ? "critical" : "warning",
          });
        }
      }
    } else if (valueIsPct && v >= congThresh) {
      // snapshot data (no timestamps) still counts congested samples
      a.congestedHours++;
    }
  }

  /* ------------------------------ entity stats ------------------------------ */
  const windowDays = frame.hasTime ? Math.max(1, Math.round((frame.timeEnd - frame.timeStart) / DAY_MS)) : 1;
  const chronicWindow = Math.min(windowDays, THRESHOLDS.chronicWindowDays);
  const lastDay = frame.hasTime ? Math.floor((frame.timeEnd - start) / DAY_MS) : 0;

  const entityStats: EntityStat[] = [];
  for (const [ent, a] of acc) {
    if (a.utils.length === 0) continue;
    const avg = mean(a.utils);
    const p95 = percentile(a.utils, 95);
    const peak = Math.max(...(a.utils.length > 50_000 ? a.utils.slice(0, 50_000) : a.utils));

    // growth: linear regression on daily peaks
    const days = [...a.dailyPeak.keys()].sort((x, y) => x - y);
    let growthPctPerWeek = 0;
    let saturationDate: number | null = null;
    if (days.length >= 5) {
      const ys = days.map((d) => a.dailyPeak.get(d)!);
      const lr = linreg(days, ys);
      // for utilization %, slope×7 already reads as percentage points; for any
      // other measure normalize by the mean so it's a true %-change per week
      growthPctPerWeek = valueIsPct ? lr.slope * 7 : avg > 0 ? ((lr.slope * 7) / avg) * 100 : 0;
      if (valueIsPct && p95 < THRESHOLDS.saturation) {
        const holt = holtForecast(ys, THRESHOLDS.saturationLookaheadDays);
        const idx = holt.forecast.findIndex((f) => f >= THRESHOLDS.saturation);
        if (idx >= 0) saturationDate = frame.timeEnd + (idx + 1) * DAY_MS;
      } else if (valueIsPct) {
        saturationDate = frame.timeEnd; // already at/over threshold
      }
    }

    // chronic: congested on >= N days within the trailing window
    const recentCongestedDays = [...a.congestedDayset].filter((d) => d > lastDay - chronicWindow).length;
    const chronic = recentCongestedDays >= Math.min(THRESHOLDS.chronicMinDays, Math.max(2, Math.floor(chronicWindow / 2)));

    const alarmsPerDay = a.alarms / windowDays;
    const risk = valueIsPct
      ? clamp(
          clamp(((p95 - 55) / 45) * 42, 0, 42) +
            clamp((a.congestedDayset.size / windowDays) * 28, 0, 28) +
            clamp((growthPctPerWeek / 3.5) * 16, 0, 16) +
            clamp((alarmsPerDay / 25) * 14, 0, 14),
          0,
          100
        )
      : clamp(clamp((growthPctPerWeek / Math.max(1, avg)) * 300, 0, 60) + clamp(alarmsPerDay, 0, 40), 0, 100);

    entityStats.push({
      entity: ent,
      region: a.region,
      technology: a.technology,
      vendor: a.vendor,
      avgUtil: avg,
      peakUtil: peak,
      p95Util: p95,
      congestedHours: a.congestedHours,
      congestedDays: a.congestedDayset.size,
      chronic,
      growthPctPerWeek,
      trafficMbps: a.traffic.length ? mean(a.traffic) : undefined,
      capacityMbps: a.capacity || undefined,
      subscribers: a.subscribers || undefined,
      alarmCount: a.alarms,
      riskScore: risk,
      saturationDate,
    });
  }
  // For non-percent measures where higher = worse (critical minutes, alarms…),
  // risk is the entity's share of the worst observed value.
  if (!valueIsPct && mapping.measureHigherIsBad && entityStats.length > 0) {
    const maxAvg = Math.max(...entityStats.map((e) => e.avgUtil), 1e-9);
    for (const e of entityStats) {
      e.riskScore = clamp((e.avgUtil / maxAvg) * 85 + (e.growthPctPerWeek > 0 ? 12 : 0), 0, 100);
    }
  }
  entityStats.sort((x, y) => y.riskScore - x.riskScore);

  /* ------------------------------ region stats ------------------------------ */
  const regionStats: RegionStat[] = [];
  const regionsList = frame.regions.length ? frame.regions : ["All regions"];
  for (const reg of regionsList) {
    const ents = entityStats.filter((e) => e.region === reg);
    if (ents.length === 0) continue;
    const allUtil = ents.map((e) => e.avgUtil);
    const congested = ents.filter((e) => e.congestedHours > 0);
    const chronic = ents.filter((e) => e.chronic);
    const evCount = events.filter((e) => e.region === reg).length;
    const alarms = ents.reduce((s, e) => s + e.alarmCount, 0);
    const traffic = ents.reduce((s, e) => s + (e.trafficMbps ?? 0), 0);
    // every element in a higher-is-bad report (critical MSANs…) is impacted
    const impactedSet = valueIsPct ? congested : mapping.measureHigherIsBad ? ents : [];
    const subsImpacted = impactedSet.reduce((s, e) => s + (e.subscribers ?? 0), 0);

    // availability mean for region
    let availability: number | null = null;
    if (frame.availability && frame.region) {
      let s = 0;
      let c = 0;
      for (let i = 0; i < n; i++) {
        if (frame.region[i] === reg) {
          const av = frame.availability[i];
          if (av !== null) {
            s += av;
            c++;
          }
        }
      }
      availability = c ? s / c : null;
    }

    const growth = mean(ents.map((e) => e.growthPctPerWeek));
    const congestedShare = congested.length / ents.length;
    const chronicShare = chronic.length / ents.length;
    const avgU = mean(allUtil);
    const criticalAlarms = 0; // filled below from frame to avoid double loop cost when absent

    const health = valueIsPct
      ? clamp(
          100 -
            (clamp((avgU - 52) * 0.55, 0, 16) +
              congestedShare * 30 +
              chronicShare * 26 +
              clamp((alarms / windowDays / Math.max(1, ents.length)) * 1.2, 0, 12) +
              (availability !== null ? clamp((THRESHOLDS.slaAvailabilityTarget - availability) * 14, 0, 12) : 0)),
          5,
          99.5
        )
      : clamp(72 + (growth > 0 ? 12 : -8), 5, 99.5);

    regionStats.push({
      region: reg,
      entities: ents.length,
      avgUtil: avgU,
      peakUtil: Math.max(...ents.map((e) => e.peakUtil)),
      p95Util: percentile(
        ents.map((e) => e.p95Util),
        80
      ),
      congestedEntities: congested.length,
      chronicEntities: chronic.length,
      congestionEvents: evCount,
      alarmCount: alarms,
      criticalAlarms,
      availability,
      healthScore: health,
      riskScore: clamp(100 - health + chronicShare * 10, 0, 100),
      growthPctPerWeek: growth,
      subscribersImpacted: subsImpacted,
      trafficMbps: traffic,
    });
  }
  // critical alarms per region (single pass)
  if (frame.criticalAlarms && frame.region) {
    const critByRegion = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const cr = frame.criticalAlarms[i];
      if (cr) critByRegion.set(frame.region[i], (critByRegion.get(frame.region[i]) ?? 0) + cr);
    }
    for (const rs of regionStats) rs.criticalAlarms = critByRegion.get(rs.region) ?? 0;
  }
  // higher-is-bad measures: regional health from relative severity
  if (!valueIsPct && mapping.measureHigherIsBad && regionStats.length > 0) {
    const maxAvg = Math.max(...regionStats.map((r) => r.avgUtil), 1e-9);
    for (const r of regionStats) {
      r.healthScore = clamp(97 - (r.avgUtil / maxAvg) * 42, 5, 99.5);
      r.riskScore = clamp(100 - r.healthScore, 0, 100);
    }
  }
  regionStats.sort((a, b) => b.riskScore - a.riskScore);

  /* ----------------------------- busy hour / heatmap ------------------------ */
  const hasHourly = frame.hasTime && hourCount.some((c, h) => c > 0 && h !== new Date(frame.timeStart).getHours());
  const distinctHours = hourCount.filter((c) => c > 0).length;
  const busyHourProfile: (number | null)[] =
    frame.hasTime && distinctHours >= 6 ? hourSum.map((s, h) => (hourCount[h] ? s / hourCount[h] : null)) : [];

  let heatmap: HeatmapData | null = null;
  if (valueIsPct && frame.regions.length > 1 && distinctHours >= 6 && hasHourly) {
    const regs = [...regionStats].sort((a, b) => b.avgUtil - a.avgUtil).map((r) => r.region);
    heatmap = {
      regions: regs,
      matrix: regs.map((reg) => {
        const sums = regionHourSum.get(reg);
        const counts = regionHourCount.get(reg);
        if (!sums || !counts) return new Array(24).fill(null);
        return sums.map((s, h) => (counts[h] ? s / counts[h] : null));
      }),
    };
  }

  /* ------------------------------- daily trends ----------------------------- */
  let dailyTrend: IntelligenceOutput["dailyTrend"] = null;
  if (frame.hasTime && dayOverall.size >= 3) {
    const days = [...dayOverall.keys()].sort((a, b) => a - b);
    const overall: NamedSeries = {
      name: valueIsPct ? "Avg utilization" : frame.measureName,
      points: days.map((d) => ({ t: start + d * DAY_MS, v: dayOverall.get(d)!.s / dayOverall.get(d)!.c })),
    };
    const topRegions = [...regionStats].sort((a, b) => b.avgUtil - a.avgUtil).slice(0, 6).map((r) => r.region);
    const byRegion: NamedSeries[] = topRegions.map((reg) => {
      const dr = dayRegion.get(reg)!;
      const rdays = [...dr.keys()].sort((a, b) => a - b);
      return { name: reg, points: rdays.map((d) => ({ t: start + d * DAY_MS, v: dr.get(d)!.s / dr.get(d)!.c })) };
    });
    let traffic: NamedSeries | undefined;
    if (dayTraffic.size >= 3) {
      traffic = {
        name: "Total traffic (avg concurrent)",
        points: days
          .filter((d) => dayTraffic.has(d))
          .map((d) => {
            const dt = dayTraffic.get(d)!;
            return { t: start + d * DAY_MS, v: dt.s / Math.max(1, dt.hours.size) };
          }),
      };
    }
    dailyTrend = { overall, byRegion, traffic };
  }

  /* -------------------------------- sankey ---------------------------------- */
  let sankey: SankeyData | null = null;
  if (valueIsPct && frame.regions.length > 1 && entityStats.length > 4) {
    const buckets = ["Healthy", "Elevated", "Congested", "Critical"];
    const links = new Map<string, number>();
    for (const e of entityStats) {
      const bucket =
        e.p95Util >= THRESHOLDS.utilizationCritical
          ? "Critical"
          : e.p95Util >= THRESHOLDS.utilizationCongested
            ? "Congested"
            : e.p95Util >= THRESHOLDS.utilizationWarning
              ? "Elevated"
              : "Healthy";
      const traffic = e.trafficMbps ?? e.avgUtil;
      const key = `${e.region}→${bucket}`;
      links.set(key, (links.get(key) ?? 0) + traffic);
    }
    const topRegs = regionStats.slice(0, 8).map((r) => r.region);
    sankey = {
      nodes: [...topRegs.map((r) => ({ name: r })), ...buckets.map((b) => ({ name: b }))],
      links: [...links.entries()]
        .filter(([k]) => topRegs.includes(k.split("→")[0]))
        .map(([k, v]) => ({ source: k.split("→")[0], target: k.split("→")[1], value: Math.round(v) })),
    };
  }

  /* ----------------------------- distribution ------------------------------- */
  let distribution: IntelligenceOutput["distribution"] = null;
  if (value) {
    const vals: number[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 30_000))) {
      const v = value[i];
      if (v !== null) vals.push(v);
    }
    if (vals.length > 20) {
      const binCount = 14;
      const lo = valueIsPct ? 0 : Math.min(...vals);
      const hi = valueIsPct ? 100 : Math.max(...vals);
      const width = (hi - lo) / binCount || 1;
      const counts = new Array(binCount).fill(0);
      for (const v of vals) {
        let b = Math.floor((v - lo) / width);
        if (b >= binCount) b = binCount - 1;
        if (b < 0) b = 0;
        counts[b]++;
      }
      distribution = {
        bins: counts.map((_, i) => `${Math.round(lo + i * width)}–${Math.round(lo + (i + 1) * width)}`),
        counts,
        metric: valueIsPct ? "Utilization %" : frame.measureName,
      };
    }
  }

  /* ------------------------------ health score ------------------------------ */
  let healthScore = 82;
  if (valueIsPct && entityStats.length > 0) {
    const avgU = mean(entityStats.map((e) => e.avgUtil));
    const congShare = entityStats.filter((e) => e.congestedHours > 0).length / entityStats.length;
    const chronicShare = entityStats.filter((e) => e.chronic).length / entityStats.length;
    const alarmsPerEntDay = entityStats.reduce((s, e) => s + e.alarmCount, 0) / Math.max(1, entityStats.length) / windowDays;
    let availPenalty = 0;
    const availRegions = regionStats.filter((r) => r.availability !== null);
    if (availRegions.length) {
      const avgAvail = mean(availRegions.map((r) => r.availability!));
      availPenalty = clamp((THRESHOLDS.slaAvailabilityTarget - avgAvail) * 12, 0, 10);
    }
    healthScore = clamp(
      100 -
        (clamp((avgU - 52) * 0.5, 0, 15) +
          congShare * 26 +
          chronicShare * 24 +
          clamp(alarmsPerEntDay * 0.9, 0, 12) +
          availPenalty),
      5,
      99.5
    );
  } else if (regionStats.length > 0) {
    healthScore = mean(regionStats.map((r) => r.healthScore));
  }

  /* ------------------- per-element daily series (top risk) ------------------ */
  const topEntityDaily: NamedSeries[] = [];
  if (frame.hasTime) {
    for (const e of entityStats.slice(0, 12)) {
      const a = acc.get(e.entity);
      if (!a || a.dailyPeak.size < 2) continue;
      const days = [...a.dailyPeak.keys()].sort((x, y) => x - y);
      topEntityDaily.push({
        name: e.entity,
        points: days.map((d) => ({ t: start + d * DAY_MS, v: a.dailyPeak.get(d)! })),
      });
    }
  }

  return {
    entityStats,
    regionStats,
    congestionEvents: events,
    busyHourProfile,
    heatmap,
    dailyTrend,
    healthScore,
    sankey,
    distribution,
    topEntityDaily,
  };
}
