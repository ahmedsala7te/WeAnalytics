import { fmtDate, fmtNum, fmtPct, fmtSigned, titleCase, uid } from "@/lib/format";
import { healthLabel, THRESHOLDS } from "@/lib/constants";
import { paretoCover } from "@/lib/stats";
import type {
  Anomaly,
  CongestionEvent,
  DomainScore,
  EntityStat,
  ExecutiveStory,
  ForecastResult,
  Insight,
  Kpi,
  RegionStat,
  RootCauseReport,
} from "@/lib/types";
import { DAY_MS, type Frame } from "./frame";

/* ------------------------------------------------------------------------
 * Agent 10 — Executive Storytelling
 * Turns computed artifacts into an executive narrative + insight feed.
 * ---------------------------------------------------------------------- */

export interface StoryOutput {
  story: ExecutiveStory;
  insights: Insight[];
}

export function composeStory(
  frame: Frame,
  domains: DomainScore[],
  kpis: Kpi[],
  entityStats: EntityStat[],
  regionStats: RegionStat[],
  events: CongestionEvent[],
  anomalies: Anomaly[],
  rootCauses: RootCauseReport[],
  forecasts: ForecastResult[],
  healthScore: number,
  utilMode: boolean,
  higherIsBad = false
): StoryOutput {
  const insights: Insight[] = [];
  const windowDays = frame.hasTime ? Math.max(1, Math.round((frame.timeEnd - frame.timeStart) / DAY_MS)) : 0;
  const chronic = entityStats.filter((e) => e.chronic);
  const worstRegion = regionStats[0];
  const kpi = (name: string) => kpis.find((k) => k.name === name);

  let headline: string;
  let summary: string;
  const keyInsights: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (utilMode && entityStats.length > 0) {
    /* ------------------------------ headline ------------------------------ */
    if (chronic.length > 0) {
      headline = `Network health is ${healthScore.toFixed(1)}/100 (${healthLabel(healthScore)}) — ${chronic.length} chronic congestion point${
        chronic.length === 1 ? "" : "s"
      } need capacity expansion within 30 days.`;
    } else if (events.length > 0) {
      headline = `Network health is ${healthScore.toFixed(1)}/100 (${healthLabel(healthScore)}) — congestion is present but not yet chronic.`;
    } else {
      headline = `Network health is ${healthScore.toFixed(1)}/100 (${healthLabel(healthScore)}) — no congestion detected in the analysis window.`;
    }

    /* ------------------------------ summary ------------------------------- */
    const byEntity = new Map<string, number>();
    for (const e of events) byEntity.set(e.entity, (byEntity.get(e.entity) ?? 0) + 1);
    const sortedCounts = [...byEntity.values()].sort((a, b) => b - a);
    const cover = paretoCover(sortedCounts, 70);

    const parts: string[] = [];
    parts.push(
      `Analysis of ${fmtNum(frame.n, 0)} measurements across ${entityStats.length} network elements${
        regionStats.length > 1 ? ` in ${regionStats.length} regions` : ""
      }${windowDays ? ` over ${windowDays} days` : ""} classifies this dataset as ${domains[0]?.domain ?? "Telecom"} (${domains[0]?.confidence ?? 0}% confidence).`
    );
    if (events.length > 0 && cover.count > 0) {
      parts.push(
        `${fmtPct(cover.share, 0)} of the ${fmtNum(events.length, 0)} congestion events originate from ${cover.count} element${
          cover.count === 1 ? "" : "s"
        } operating above ${THRESHOLDS.utilizationCongested}% during busy hours${
          worstRegion ? `, led by ${worstRegion.region} (${worstRegion.congestionEvents} events, ${worstRegion.chronicEntities} chronic)` : ""
        }.`
      );
    }
    const growthKpi = kpi("Traffic Growth Rate");
    if (growthKpi && growthKpi.value > 0.3) {
      parts.push(`Traffic is growing ${fmtPct(growthKpi.value, 1)} per week network-wide.`);
    }
    const peakFc = forecasts.find((f) => f.saturationDate !== null);
    if (peakFc?.saturationDate) {
      parts.push(`At the current trend, ${peakFc.name.toLowerCase()} crosses ${peakFc.saturationThreshold}% around ${fmtDate(peakFc.saturationDate)}.`);
    }
    const subsKpi = kpi("Subscriber Impact");
    if (subsKpi && subsKpi.value > 0) {
      parts.push(`≈${fmtNum(subsKpi.value, 0)} subscribers are exposed to busy-hour degradation today.`);
    }
    summary = parts.join(" ");

    /* ---------------------------- key insights ---------------------------- */
    if (worstRegion && worstRegion.congestionEvents > 0) {
      const trendNote =
        worstRegion.growthPctPerWeek > 0.5 ? ` and demand is growing ${fmtPct(worstRegion.growthPctPerWeek, 1)}/week` : "";
      keyInsights.push(
        `${worstRegion.region} is the most stressed region — health ${worstRegion.healthScore.toFixed(0)}/100, ${worstRegion.congestedEntities}/${worstRegion.entities} elements congested${trendNote}.`
      );
    }
    if (cover.count > 0 && events.length > 0) {
      keyInsights.push(
        `Congestion is highly concentrated: ${cover.count} elements drive ${fmtPct(cover.share, 0)} of events — a targeted expansion fixes most of the problem.`
      );
    }
    const busyKpi = kpi("Busy-Hour Utilization");
    if (busyKpi) {
      keyInsights.push(`${busyKpi.description.replace("Average utilization during the network busy hour", "Busy hour")} averages ${fmtPct(busyKpi.value, 1)} network-wide.`);
    }
    const availKpi = kpi("Service Availability");
    if (availKpi && availKpi.value < THRESHOLDS.slaAvailabilityTarget) {
      keyInsights.push(`Availability (${fmtPct(availKpi.value, 2)}) is below the ${THRESHOLDS.slaAvailabilityTarget}% SLA target.`);
    }
    const storm = anomalies.find((a) => a.kind === "alarm_storm");
    if (storm) keyInsights.push(storm.text + ".");
    const headroomKpi = kpi("Capacity Headroom");
    if (headroomKpi) keyInsights.push(`Effective capacity headroom is ${fmtPct(headroomKpi.value, 1)} at the 80th percentile of element peaks.`);

    /* ------------------------------- risks -------------------------------- */
    const saturating = entityStats.filter((e) => e.saturationDate !== null && e.saturationDate <= Date.now() + 60 * DAY_MS);
    if (saturating.length > 0) {
      const earliest = saturating.reduce((a, b) => ((a.saturationDate ?? Infinity) < (b.saturationDate ?? Infinity) ? a : b));
      risks.push(
        `${saturating.length} element${saturating.length === 1 ? "" : "s"} forecast to saturate within 60 days (earliest: ${earliest.entity}, ${fmtDate(earliest.saturationDate)}).`
      );
    }
    if (chronic.length > 0) {
      const subs = chronic.reduce((s, e) => s + (e.subscribers ?? 0), 0);
      risks.push(
        `${chronic.length} chronic congestion points${subs ? ` affecting ≈${fmtNum(subs, 0)} subscribers` : ""} — sustained quality degradation and churn exposure.`
      );
    }
    if (worstRegion && worstRegion.healthScore < 65) {
      risks.push(`${worstRegion.region} regional health (${worstRegion.healthScore.toFixed(0)}/100) is approaching critical territory.`);
    }
    const critKpi = kpi("Critical Alarms");
    if (critKpi && critKpi.changePct !== null && critKpi.changePct > 30) {
      risks.push(`Critical alarms up ${fmtSigned(critKpi.changePct, 0)} week-over-week.`);
    }
    if (risks.length === 0) risks.push("No high-severity risks detected in this window — maintain monitoring cadence.");

    /* -------------------------- recommendations --------------------------- */
    if (chronic.length > 0) {
      const topChronic = [...chronic].sort((a, b) => b.riskScore - a.riskScore).slice(0, 15);
      recommendations.push(
        `Expand uplink capacity on ${topChronic.length} chronic elements within 30 days (priority: ${topChronic
          .slice(0, 3)
          .map((e) => e.entity)
          .join(", ")}…).`
      );
    }
    if (saturating.length > 0) {
      recommendations.push(`Approve capacity budget for ${saturating.length} elements saturating ≤60 days; sequence by exhaustion date.`);
    }
    if (worstRegion && worstRegion.congestedEntities > 2) {
      recommendations.push(`Run a focused capacity review for ${worstRegion.region} covering backhaul and aggregation layers, not only access uplinks.`);
    }
    if (storm) {
      recommendations.push("Close the loop on the outage signature: verify transmission redundancy and add trap-compression rules in fault management.");
    }
    recommendations.push("Re-run this analysis weekly and track the Network Health Score trend as the single executive KPI.");
  } else {
    /* -------------------- breakdown / measure-mode story -------------------- */
    const measureName = frame.measureName.replace(/[_-]+/g, " ");
    const telecomish = ["Telecom", "Performance Management", "Capacity Planning", "Service Assurance", "Operations"].includes(domains[0]?.domain ?? "");
    const good = !higherIsBad; // volume / subscribers / revenue — bigger is healthier
    const subsKpi = kpi("Total Subscribers");
    const perSubKpi = kpis.find((k) => /per subscriber/i.test(k.name));
    const growth = kpis.find((k) => /growth|degradation trend/i.test(k.name));
    const headlineKpi = subsKpi ?? kpis[0];
    // rank segments by subscribers (good) or by the measure
    const segs = [...entityStats].sort((a, b) =>
      subsKpi ? (b.subscribers ?? 0) - (a.subscribers ?? 0) : higherIsBad ? b.avgUtil - a.avgUtil : b.avgUtil - a.avgUtil
    );
    const lead = segs[0];

    headline = headlineKpi
      ? `${domains[0]?.domain ?? "Dataset"} · ${headlineKpi.name} ${fmtNum(headlineKpi.value, 0)}${headlineKpi.unit === "%" ? "%" : ""}${
          growth ? ` — ${measureName} trending ${fmtSigned(growth.value, 1)}/week.` : "."
        }`
      : `${domains[0]?.domain ?? "Dataset"} analyzed — ${fmtNum(frame.n, 0)} records${windowDays ? ` over ${windowDays} days` : ""}.`;

    summary = [
      `Analysis of ${fmtNum(frame.n, 0)} records classifies this as ${domains[0]?.domain ?? "Generic Business"} (${domains[0]?.confidence ?? 0}% confidence), broken down across ${frame.entities.length} ${frame.entities.length === 1 ? "segment" : "segments"} by ${measureName}.`,
      subsKpi ? `Active subscriber base is ${fmtNum(subsKpi.value, 0)}${subsKpi.changePct !== null ? ` (${fmtSigned(subsKpi.changePct, 1)} vs prior)` : ""}.` : "",
      perSubKpi ? `${perSubKpi.name} is ${fmtNum(perSubKpi.value)}.` : "",
      lead ? `${lead.entity} is the largest segment${lead.subscribers ? ` with ${fmtNum(lead.subscribers, 0)} subscribers` : ` by ${measureName}`}.` : "",
      good
        ? "This dataset has no utilization metric, so congestion/saturation analytics do not apply — the focus is subscriber base, traffic mix and growth."
        : `This report carries no utilization percentage; the analysis ranks segments by ${measureName} severity instead.`,
    ]
      .filter(Boolean)
      .join(" ");

    if (subsKpi) keyInsights.push(`Total subscribers: ${fmtNum(subsKpi.value, 0)}${growth ? ` · base ${fmtSigned((kpi("Subscriber Growth")?.value ?? 0), 1)}/wk` : ""}.`);
    if (growth) keyInsights.push(`${titleCase(measureName)} is trending ${fmtSigned(growth.value, 1)} per week.`);
    if (perSubKpi) keyInsights.push(`${perSubKpi.name}: ${fmtNum(perSubKpi.value)} — ${perSubKpi.description}`);
    if (lead && segs.length > 1) {
      const share = subsKpi && segs.reduce((s, e) => s + (e.subscribers ?? 0), 0) > 0
        ? ((lead.subscribers ?? 0) / segs.reduce((s, e) => s + (e.subscribers ?? 0), 0)) * 100
        : null;
      keyInsights.push(`Largest segment: ${lead.entity}${share !== null ? ` (${fmtPct(share, 0)} of subscribers)` : ` by ${measureName}`}.`);
    }
    for (const a of anomalies.slice(0, 2)) keyInsights.push(a.text + ".");

    if (good) {
      if (growth && growth.value > 1) risks.push(`${titleCase(measureName)} is growing ${fmtSigned(growth.value, 1)}/week — plan capacity ahead of demand.`);
      if (lead && segs.length > 1) {
        const share = subsKpi ? ((lead.subscribers ?? 0) / Math.max(1, segs.reduce((s, e) => s + (e.subscribers ?? 0), 0))) * 100 : 0;
        if (share > 70) risks.push(`Heavy concentration: ${lead.entity} holds ${fmtPct(share, 0)} of the base — limited diversification.`);
      }
      if (risks.length === 0) risks.push("No structural risks evident in this window — healthy growth profile.");
      recommendations.push(`Track ${measureName} and the subscriber base weekly; size capacity to the ${growth ? fmtSigned(growth.value, 1) + "/wk" : "current"} growth trend.`);
      if (perSubKpi) recommendations.push(`Monitor ${perSubKpi.name.toLowerCase()} for plan up-sell and tariff opportunities.`);
      recommendations.push("Upload utilization/capacity data alongside this to unlock congestion and saturation forecasting.");
    } else {
      risks.push(`Segments at the top of the ${measureName} ranking represent the worst service exposure.`);
      recommendations.push(`Prioritize remediation of the top ${Math.min(5, entityStats.length)} segments by ${measureName}; track week-over-week movement.`);
      recommendations.push("Add a utilization/capacity column to future exports to unlock congestion analytics.");
    }
    void telecomish;
  }

  /* ----------------------------- insight feed ----------------------------- */
  const sev = (s: number): Insight["severity"] => (s >= 85 ? "critical" : s >= 60 ? "warning" : "info");
  let p = 1;
  for (const rc of rootCauses) {
    insights.push({
      id: uid("ins"),
      kind: "root_cause",
      severity: rc.scope === "Alarm storm" || rc.scope === "Congestion" ? "critical" : "warning",
      title: rc.scope,
      body: `${rc.what} ${rc.why}`,
      priority: p++,
    });
  }
  for (const k of keyInsights.slice(0, 5)) {
    insights.push({ id: uid("ins"), kind: "finding", severity: "info", title: "Key finding", body: k, priority: p++ });
  }
  for (const r of risks.slice(0, 4)) {
    insights.push({ id: uid("ins"), kind: "risk", severity: sev(70), title: "Risk", body: r, priority: p++ });
  }
  for (const r of recommendations.slice(0, 5)) {
    insights.push({ id: uid("ins"), kind: "recommendation", severity: "success", title: "Recommendation", body: r, priority: p++ });
  }
  for (const a of anomalies.slice(0, 4)) {
    insights.push({
      id: uid("ins"),
      kind: "anomaly",
      severity: a.severity === "critical" ? "critical" : "warning",
      title: a.kind === "alarm_storm" ? "Alarm storm" : a.kind === "spike" ? "Traffic spike" : "Sudden drop",
      body: a.text,
      priority: p++,
    });
  }

  return {
    story: { headline, summary, keyInsights, rootCauses: rootCauses.map((r) => `${r.scope}: ${r.why}`), risks, recommendations },
    insights,
  };
}
