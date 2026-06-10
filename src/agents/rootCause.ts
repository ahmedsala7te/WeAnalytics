import { fmtDate, fmtNum, fmtPct, uid } from "@/lib/format";
import { paretoCover } from "@/lib/stats";
import { THRESHOLDS } from "@/lib/constants";
import type { Anomaly, CongestionEvent, CorrelationPair, EntityStat, RegionStat, RootCauseReport } from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";

/* ------------------------------------------------------------------------
 * Agent 8 — Root Cause Analysis
 * Rule-based causal reasoning over the computed artifacts: what happened,
 * why, which elements are affected, expected impact and actions.
 * ---------------------------------------------------------------------- */

export function computeRootCauses(
  frame: Frame,
  entityStats: EntityStat[],
  regionStats: RegionStat[],
  events: CongestionEvent[],
  anomalies: Anomaly[],
  correlations: CorrelationPair[]
): RootCauseReport[] {
  const reports: RootCauseReport[] = [];
  const windowDays = frame.hasTime ? Math.max(1, Math.round((frame.timeEnd - frame.timeStart) / DAY_MS)) : 1;

  /* ---------------- 1. Congestion concentration (Pareto) ---------------- */
  if (events.length > 0) {
    const byEntity = new Map<string, number>();
    for (const e of events) byEntity.set(e.entity, (byEntity.get(e.entity) ?? 0) + 1);
    const sorted = [...byEntity.entries()].sort((a, b) => b[1] - a[1]);
    const cover = paretoCover(
      sorted.map(([, c]) => c),
      70
    );
    const topRegion = [...regionStats].sort((a, b) => b.congestionEvents - a.congestionEvents)[0];
    const topEntities = sorted.slice(0, cover.count);
    const topEntityStats = topEntities
      .map(([name]) => entityStats.find((s) => s.entity === name))
      .filter((x): x is EntityStat => !!x);
    const avgGrowth = topEntityStats.length
      ? topEntityStats.reduce((s, e) => s + e.growthPctPerWeek, 0) / topEntityStats.length
      : 0;
    const subs = topEntityStats.reduce((s, e) => s + (e.subscribers ?? 0), 0);
    const regionShare = topRegion ? (topRegion.congestionEvents / events.length) * 100 : 0;

    reports.push({
      id: uid("rca"),
      scope: "Congestion",
      what: `${fmtNum(events.length, 0)} congestion events (≥${THRESHOLDS.utilizationCongested}% utilization) were detected over ${windowDays} days${
        topRegion ? `, with ${topRegion.region} contributing ${fmtPct(regionShare, 0)} of the total` : ""
      }.`,
      why: `${fmtPct(cover.share, 0)} of all congestion events originate from just ${cover.count} element${
        cover.count === 1 ? "" : "s"
      } whose busy-hour demand exceeds provisioned uplink capacity${
        avgGrowth > 0.5 ? `, compounded by traffic growth of ${fmtPct(avgGrowth, 1)}/week on those elements` : ""
      }. This is a structural capacity gap, not a transient incident.`,
      affected: topEntities.slice(0, 10).map(([name, c]) => `${name} (${c} events)`),
      impact: subs > 0 ? `≈${fmtNum(subs, 0)} subscribers experience degraded throughput during busy hours.` : `Busy-hour service quality degradation in affected areas.`,
      actions: [
        `Prioritize uplink capacity expansion on the ${Math.min(cover.count, 15)} highest-impact elements within 30 days.`,
        "Rebalance subscribers from saturated elements to adjacent ones where feasible.",
        "Enforce busy-hour QoS profiles to protect priority traffic until upgrades land.",
      ],
      confidence: Math.min(0.95, 0.65 + cover.share / 250),
    });
  }

  /* ----------------------- 2. Alarm storm / outage ----------------------- */
  const storm = anomalies.find((a) => a.kind === "alarm_storm");
  if (storm && frame.hasTime) {
    // pass 1: locate the region with the alarm concentration that day
    const dayStart = Math.floor(storm.time / DAY_MS) * DAY_MS;
    const regionAlarms = new Map<string, number>();
    for (let i = 0; i < frame.n; i++) {
      const t = frame.t[i];
      if (t === null || t < dayStart || t >= dayStart + DAY_MS) continue;
      const al = frame.alarms ? frame.alarms[i] : null;
      if (al && frame.region) regionAlarms.set(frame.region[i], (regionAlarms.get(frame.region[i]) ?? 0) + al);
    }
    const hotRegion = [...regionAlarms.entries()].sort((a, b) => b[1] - a[1])[0];

    // pass 2: capacity-normalized load drop + availability dip inside the affected region only
    const loadCol = frame.util ?? frame.traffic;
    let dayLoad = 0;
    let dayLoadN = 0;
    let baseLoad = 0;
    let baseLoadN = 0;
    let dayAvail = 0;
    let dayAvailN = 0;
    let baseAvail = 0;
    let baseAvailN = 0;
    for (let i = 0; i < frame.n; i++) {
      const t = frame.t[i];
      if (t === null) continue;
      if (hotRegion && frame.region && frame.region[i] !== hotRegion[0]) continue;
      const inDay = t >= dayStart && t < dayStart + DAY_MS;
      const ld = loadCol ? loadCol[i] : null;
      if (ld !== null && ld !== undefined) {
        if (inDay) {
          dayLoad += ld;
          dayLoadN++;
        } else {
          baseLoad += ld;
          baseLoadN++;
        }
      }
      const av = frame.availability ? frame.availability[i] : null;
      if (av !== null && av !== undefined) {
        if (inDay) {
          dayAvail += av;
          dayAvailN++;
        } else {
          baseAvail += av;
          baseAvailN++;
        }
      }
    }
    const avgDay = dayLoadN ? dayLoad / dayLoadN : 0;
    const avgBase = baseLoadN ? baseLoad / baseLoadN : 0;
    const drop = avgBase > 0 ? ((avgBase - avgDay) / avgBase) * 100 : 0;
    const availDip = dayAvailN && baseAvailN ? baseAvail / baseAvailN - dayAvail / dayAvailN : 0;
    const dropAnomaly = anomalies.find((a) => a.kind === "drop" && Math.abs(a.time - storm.time) < 2 * DAY_MS);
    const outageSignature = !!dropAnomaly || drop > 3 || availDip > 0.4;

    reports.push({
      id: uid("rca"),
      scope: "Alarm storm",
      what: `An alarm storm occurred on ${fmtDate(storm.time)} — ${fmtNum(storm.value, 0)} alarms vs a normal baseline of ${fmtNum(storm.expected, 0)}/day${
        hotRegion ? `, concentrated in ${hotRegion[0]}` : ""
      }.`,
      why: outageSignature
        ? `The storm coincides with a simultaneous carried-load drop${hotRegion ? ` in ${hotRegion[0]}` : ""}${
            drop > 3 ? ` (≈${fmtPct(drop, 0)} below baseline)` : ""
          }${availDip > 0.4 ? ` and an availability dip of ${availDip.toFixed(1)} points` : ""} — a signature consistent with a transmission/fiber outage upstream of the affected elements, with cascading element alarms (repeated traps) rather than independent failures.`
        : `Alarm concentration without a matching traffic drop suggests an element-level fault or a flapping condition generating repeated traps.`,
      affected: hotRegion ? [`${hotRegion[0]} (${fmtNum(hotRegion[1], 0)} alarms)`] : [],
      impact: "Service interruption risk for downstream subscribers during the event window; alarm flooding can also mask unrelated faults in the NOC.",
      actions: [
        "Verify transmission/backhaul path integrity for the affected region (fiber, microwave, DWDM spans).",
        "Review protection/redundancy on the implicated route and re-test failover.",
        "Add a correlation rule in fault management to compress repeated traps from a single upstream cause.",
      ],
      confidence: outageSignature ? 0.86 : 0.62,
    });
  }

  /* --------------------- 3. Growth-driven saturation --------------------- */
  const saturating = entityStats
    .filter((e) => e.saturationDate !== null && e.saturationDate <= Date.now() + 90 * DAY_MS)
    .sort((a, b) => (a.saturationDate ?? 0) - (b.saturationDate ?? 0));
  if (saturating.length > 0) {
    const soonest = saturating[0];
    const regions = [...new Set(saturating.map((e) => e.region))].slice(0, 4);
    reports.push({
      id: uid("rca"),
      scope: "Capacity exhaustion",
      what: `${saturating.length} element${saturating.length === 1 ? "" : "s"} are forecast to reach ≥${THRESHOLDS.saturation}% utilization within 90 days; the earliest (${soonest.entity}) by ${fmtDate(
        soonest.saturationDate
      )}.`,
      why: `Sustained traffic growth (up to ${fmtPct(Math.max(...saturating.map((e) => e.growthPctPerWeek)), 1)}/week) against fixed provisioned capacity. Growth is organic and trend-stable, so exhaustion dates are forecastable with good confidence.`,
      affected: saturating.slice(0, 10).map((e) => `${e.entity} — ${fmtDate(e.saturationDate)} (${e.region})`),
      impact: `Without action, chronic congestion will spread across ${regions.join(", ")} and busy-hour quality will degrade for high-density areas.`,
      actions: [
        "Sequence capacity upgrades by forecast exhaustion date (earliest first).",
        "Validate forecast against commercial events (promotions, seasonal load) before committing budget.",
        "Where upgrades exceed lead time, plan interim traffic engineering or load-shifting.",
      ],
      confidence: 0.78,
    });
  }

  /* ------------------- 4. QoS ↔ congestion correlation ------------------- */
  const qosCorr = correlations.find(
    (c) =>
      (c.a === "Utilization" && (c.b === "Latency" || c.b === "Packet loss")) ||
      (c.b === "Utilization" && (c.a === "Latency" || c.a === "Packet loss"))
  );
  if (qosCorr && Math.abs(qosCorr.r) >= 0.45) {
    const qosMetric = qosCorr.a === "Utilization" ? qosCorr.b : qosCorr.a;
    reports.push({
      id: uid("rca"),
      scope: "Service quality",
      what: `${qosMetric} degrades in lock-step with utilization (Pearson r = ${qosCorr.r.toFixed(2)}).`,
      why: "Buffer pressure at high uplink occupancy translates directly into queueing delay and discards — confirming that observed QoS degradation is congestion-driven rather than caused by faulty hardware or transport errors.",
      affected: ["All elements operating above the warning threshold during busy hours"],
      impact: "Customer-perceived slowness and packet retransmissions during peak hours, concentrated on congested elements.",
      actions: [
        "Treat QoS complaints in congested areas as capacity issues — skip device-level troubleshooting.",
        "Track p95 latency on upgraded elements to validate post-expansion improvement.",
      ],
      confidence: 0.72,
    });
  }

  return reports;
}
