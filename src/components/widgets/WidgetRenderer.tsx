import { lazy, Suspense, useMemo } from "react";
import { healthLabel } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";
import { EChart } from "@/components/EChart";
import { WidgetCard } from "@/components/WidgetCard";
import { KpiCard } from "@/components/KpiCard";
import { RegionTileMap } from "./RegionTileMap";
import { InsightsPanel } from "./InsightsPanel";
import { AnomalyList } from "./AnomalyList";
import { BusinessDeltaTable, BusinessStatusBreakdownTable, EntityTable, RegionTable } from "./Tables";
import {
  areaTrendOption,
  busyHourOption,
  correlationOption,
  entityBarsOption,
  forecastOption,
  gaugeOption,
  heatmapOption,
  histogramOption,
  paretoOption,
  sankeyOption,
  scatterOption,
  treemapOption,
  trendOption,
} from "@/components/charts/options";
import type { AnalysisResult, DashboardPlanWarning, DashboardReason, Kpi, NamedSeries, TelecomBusinessCaseId, WidgetSpec } from "@/lib/types";

const EgyptNetworkMap = lazy(() => import("./EgyptNetworkMap").then((m) => ({ default: m.EgyptNetworkMap })));

/* ---------------------------- KPI set selection --------------------------- */

const KPI_SETS: Record<string, string[]> = {
  executive: ["Network Health Score", "Capacity Risk Index", "Congestion Events", "Service Availability", "Subscriber Impact", "Traffic Growth Rate"],
  noc: ["Congestion Events", "Critical Alarms", "Alarm Volume", "Peak Utilization", "Service Availability", "Busy-Hour Utilization"],
  capacity: ["Capacity Headroom", "Chronic Congestion Points", "Saturating ≤60 Days", "Traffic Growth Rate", "Capacity Risk Index", "Average Utilization"],
  performance: ["Average Utilization", "Peak Utilization", "Busy-Hour Utilization", "Congestion Events", "Average Latency", "Packet Loss"],
  assurance: ["Alarm Volume", "Critical Alarms", "Service Availability", "SLA Compliance", "Subscriber Impact", "Congestion Events"],
};

const BUSINESS_KPI_SETS: Partial<Record<TelecomBusinessCaseId, string[]>> = {
  critical_time_comparison: [
    "Latest Critical Time",
    "Latest Warning Time",
    "Worsening MSANs",
    "Worst MSAN Latest",
    "Subscribers on Worsening MSANs",
    "Tracked Entities",
  ],
  subscriber_impact: ["Total Subscribers", "Largest Segment", "Subscriber Impact", "Tracked Entities"],
  upgrade_followup: ["Tracked Entities", "Records Analyzed", "Total Subscribers"],
  congestion_risk: ["Congestion Events", "Chronic Congestion Points", "Peak Utilization", "Average Utilization", "Capacity Risk Index"],
  alarm_assurance: ["Alarm Volume", "Critical Alarms", "Service Availability", "Tracked Entities"],
};

function pickKpis(kpis: Kpi[], key: string | undefined): Kpi[] {
  if (key?.startsWith("business:")) {
    const caseId = key.slice("business:".length) as TelecomBusinessCaseId;
    const business = kpis
      .filter((k) => k.businessCaseIds?.includes(caseId))
      .sort((a, b) => (b.businessPriority ?? 0) - (a.businessPriority ?? 0));
    const picked = [...business];
    for (const name of BUSINESS_KPI_SETS[caseId] ?? []) {
      const hit = kpis.find((k) => k.name === name);
      if (hit && !picked.includes(hit)) picked.push(hit);
      if (picked.length >= 6) break;
    }
    for (const k of kpis) {
      if (picked.length >= 6) break;
      const genericNoise = caseId === "critical_time_comparison" && /subscriber growth|degradation trend/i.test(k.name);
      if (!genericNoise && !picked.includes(k)) picked.push(k);
    }
    return picked.slice(0, 6);
  }
  if (!key || key === "generic") return kpis.slice(0, 8);
  const names = KPI_SETS[key];
  if (!names) return kpis.slice(0, 6);
  const picked = names.map((n) => kpis.find((k) => k.name === n)).filter((k): k is Kpi => !!k);
  // pad with remaining high-signal KPIs
  for (const k of kpis) {
    if (picked.length >= 6) break;
    if (!picked.includes(k)) picked.push(k);
  }
  return picked.slice(0, 6);
}

/** Rebuild a daily NamedSeries from a KPI spark + the analysis time range. */
function seriesFromSpark(kpi: Kpi | undefined, a: AnalysisResult, name: string): NamedSeries | null {
  if (!kpi || kpi.spark.length < 3 || !a.timeRange) return null;
  const n = kpi.spark.length;
  const span = a.timeRange.end - a.timeRange.start;
  return {
    name,
    points: kpi.spark.map((v, i) => ({ t: a.timeRange!.start + (span * i) / Math.max(1, n - 1), v })),
  };
}

/* ------------------------------ main renderer ----------------------------- */

const SPAN_CLASS: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
  4: "md:col-span-2 xl:col-span-4",
};

export function WidgetRenderer({ spec, analysis, index }: { spec: WidgetSpec; analysis: AnalysisResult; index: number }) {
  const dark = useAppStore((s) => s.theme) === "dark";
  const a = analysis;
  const delay = Math.min(0.5, index * 0.06);
  const H = spec.tall ? 430 : 290;

  const body = useMemo(() => {
    switch (spec.type) {
      case "kpi-grid": {
        let kpis = pickKpis(a.kpis, spec.dataKey);
        // chat-driven edits: hide excluded cards, append extra ones
        if (spec.excludeKpis?.length) {
          const ex = spec.excludeKpis.map((x) => x.toLowerCase());
          kpis = kpis.filter((k) => !ex.some((x) => k.name.toLowerCase().includes(x) || x.includes(k.name.toLowerCase())));
        }
        if (spec.extraKpis?.length) {
          for (const name of spec.extraKpis) {
            const hit = a.kpis.find((k) => k.name.toLowerCase() === name.toLowerCase());
            if (hit && !kpis.some((k) => k.id === hit.id)) kpis = [...kpis, hit];
          }
        }
        return (
          <div className={`grid grid-cols-2 gap-2.5 p-1 ${spec.span === 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-3"}`}>
            {kpis.map((k, i) => (
              <KpiCard key={k.id} kpi={k} delay={delay + i * 0.05} />
            ))}
          </div>
        );
      }
      case "entity-bars": {
        const list = a.topEntityDaily.slice(0, spec.limit ?? 10);
        if (list.length === 0) return <Empty msg="Needs per-element history (a time dimension)" />;
        return <EChart option={entityBarsOption(dark, list, a.measureLabel, a.measureIsPct)} height={H - 40} registerAs={spec.title} />;
      }
      case "business-comparison-bars": {
        const list = a.topEntityDaily.slice(0, spec.limit ?? 12);
        if (list.length === 0) return <Empty msg="Needs per-element time comparison data" />;
        return <EChart option={entityBarsOption(dark, list, a.measureLabel, a.measureIsPct)} height={H - 40} registerAs={spec.title} />;
      }
      case "gauge":
        return (
          <div className="flex h-full flex-col items-center justify-center">
            <EChart option={gaugeOption(dark, a.healthScore)} height={195} registerAs="Network Health Score" />
            <p className="-mt-7 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{healthLabel(a.healthScore)}</p>
          </div>
        );
      case "tilemap":
        return <RegionTileMap regions={a.regionStats} measureLabel={a.measureLabel} isPct={a.measureIsPct} />;
      case "geo-map-3d":
        return (
          <Suspense fallback={<div className="skeleton min-h-[590px] w-full" aria-label="Loading Egypt 3D map" />}>
            <EgyptNetworkMap analysis={a} />
          </Suspense>
        );
      case "trend": {
        if (!a.dailyTrend) return <Empty msg="No time dimension detected" />;
        const series = spec.dataKey === "regions" && a.dailyTrend.byRegion.length > 1 ? a.dailyTrend.byRegion : [a.dailyTrend.overall];
        return <EChart option={trendOption(dark, series, a.measureIsPct)} height={H - 40} registerAs={spec.title} />;
      }
      case "area-trend": {
        const alarmSeries = seriesFromSpark(a.kpis.find((k) => k.name === "Alarm Volume"), a, "Alarms / day");
        if (!alarmSeries) return <Empty msg="No alarm data" />;
        return <EChart option={areaTrendOption(dark, alarmSeries)} height={H - 40} registerAs={spec.title} />;
      }
      case "heatmap":
        if (!a.heatmap) return <Empty msg="Needs hourly data across regions" />;
        return <EChart option={heatmapOption(dark, a.heatmap)} height={Math.max(H - 40, a.heatmap.regions.length * 30 + 60)} registerAs={spec.title} />;
      case "busy-hour":
        if (a.busyHourProfile.length !== 24) return <Empty msg="Needs hourly granularity" />;
        return <EChart option={busyHourOption(dark, a.busyHourProfile)} height={H - 40} registerAs={spec.title} />;
      case "pareto": {
        const byCong = spec.dataKey === "congestion";
        const bySubs = spec.dataKey === "subscribers";
        const n = spec.limit ?? 12;
        if (bySubs) {
          const top = [...a.entityStats].filter((e) => (e.subscribers ?? 0) > 0).sort((x, y) => (y.subscribers ?? 0) - (x.subscribers ?? 0)).slice(0, n);
          if (top.length === 0) return <Empty msg="No subscriber data" />;
          return (
            <EChart
              option={paretoOption(dark, top.map((e) => e.entity), top.map((e) => e.subscribers ?? 0), "subscribers")}
              height={H - 40}
              registerAs={spec.title}
            />
          );
        }
        const top = byCong
          ? [...a.entityStats].sort((x, y) => y.congestedHours - x.congestedHours).filter((e) => e.congestedHours > 0).slice(0, n)
          : [...a.entityStats].sort((x, y) => y.avgUtil - x.avgUtil).slice(0, n);
        if (top.length === 0) return <Empty msg="No congestion recorded — network is healthy" />;
        return (
          <EChart
            option={paretoOption(
              dark,
              top.map((e) => e.entity),
              top.map((e) => (byCong ? e.congestedHours : Math.round(e.avgUtil * 10) / 10)),
              byCong ? "hours ≥90%" : a.measureIsPct ? "avg %" : `avg ${a.measureLabel.toLowerCase()}`
            )}
            height={H - 40}
            registerAs={spec.title}
          />
        );
      }
      case "treemap":
        return <EChart option={treemapOption(dark, a.regionStats)} height={H - 40} registerAs={spec.title} />;
      case "sankey":
        if (!a.sankey) return <Empty msg="Insufficient flow data" />;
        return <EChart option={sankeyOption(dark, a.sankey)} height={H - 40} registerAs={spec.title} />;
      case "scatter":
        return <EChart option={scatterOption(dark, a.entityStats)} height={H - 40} registerAs={spec.title} />;
      case "forecast": {
        const idx = Number(spec.dataKey ?? 0);
        const fc = a.forecasts[idx] ?? a.forecasts[0];
        if (!fc) return <Empty msg="Needs ≥5 days of history" />;
        return (
          <div className="flex h-full flex-col">
            <EChart option={forecastOption(dark, fc)} height={H - 70} registerAs={spec.title} />
            <p className="px-2 pb-1 text-[10.5px] text-muted">
              {fc.name} · {fc.method}
              {fc.saturationDate && (
                <span className="ml-2 font-semibold text-critical-500">
                  Saturation ≈ {new Date(fc.saturationDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </p>
          </div>
        );
      }
      case "histogram":
        if (!a.distribution) return <Empty msg="No distribution available" />;
        return <EChart option={histogramOption(dark, a.distribution)} height={H - 40} registerAs={spec.title} />;
      case "table-entities":
        return (
          <EntityTable
            entities={a.entityStats}
            mode={(spec.dataKey as "risk" | "saturation" | "congestion" | "breakdown") ?? "risk"}
            measureLabel={a.measureLabel}
            isPct={a.measureIsPct}
            higherIsBad={a.measureHigherIsBad}
            maxRows={spec.limit}
          />
        );
      case "table-regions":
        return <RegionTable regions={a.regionStats} measureLabel={a.measureLabel} isPct={a.measureIsPct} higherIsBad={a.measureHigherIsBad} />;
      case "business-delta-table":
        return <BusinessDeltaTable analysis={a} maxRows={spec.limit} />;
      case "business-status-breakdown":
        return <BusinessStatusBreakdownTable analysis={a} />;
      case "anomalies":
        return <AnomalyList anomalies={a.anomalies} />;
      case "insights":
        return <InsightsPanel story={a.story} insights={a.insights} compact={!spec.tall} />;
      case "dashboard-reasoning":
        return (
          <DashboardReasoning
            reasons={a.dashboardReasoning}
            persona={spec.dataKey ?? "all"}
            prompt={a.dashboardPlanPrompt}
            engine={a.dashboardPlanEngine}
            warnings={a.dashboardPlanWarnings}
            analysis={a}
          />
        );
      case "correlation":
        if (a.correlations.length === 0) return <Empty msg="No significant correlations" />;
        return <EChart option={correlationOption(dark, a.correlations)} height={H - 40} registerAs={spec.title} />;
      default:
        return <Empty msg="Unknown widget" />;
    }
  }, [spec, a, dark, H, delay]);

  return (
    <WidgetCard
      title={spec.title}
      subtitle={spec.subtitle}
      delay={delay}
      className={`${SPAN_CLASS[spec.span]} ${spec.type === "geo-map-3d" ? "min-h-[680px]" : spec.type === "kpi-grid" || spec.type === "tilemap" ? "" : spec.tall ? "min-h-[480px]" : "min-h-[340px]"}`}
    >
      {body}
    </WidgetCard>
  );
}

function DashboardReasoning({
  reasons,
  persona,
  prompt,
  engine,
  warnings = [],
  analysis,
}: {
  reasons: DashboardReason[];
  persona: string;
  prompt?: string;
  engine?: string;
  warnings?: DashboardPlanWarning[];
  analysis: AnalysisResult;
}) {
  const shown = reasons.filter((r) => r.persona === persona || r.persona === "all").slice(0, 6);
  if (shown.length === 0) return <Empty msg="No dashboard reasoning available" />;
  const ctx = analysis.businessContext;
  return (
    <div className="space-y-2 p-1">
      {ctx && (
        <div className="rounded-xl border border-subtle bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-accent-400">
            Business Case
            <span className="rounded-full bg-inset px-1.5 py-px text-[9.5px] text-muted">{ctx.selectedLabel}</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">
            The dashboard uses the {ctx.selectedLabel.toLowerCase()} playbook. It prioritizes {analysis.measureLabel.toLowerCase()} by element,
            {ctx.regionColumn ? ` region (${ctx.regionColumn}),` : ""} and latest-vs-previous movement. Deterministic pipeline calculations remain the source of truth.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {[ctx.comparisonMeasure, ctx.warningMeasure, ctx.entityColumn, ctx.regionColumn, ctx.sectorColumn, ctx.subscriberColumn].filter(Boolean).map((c) => (
              <span key={c} className="rounded-md bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                {c}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {ctx.candidates.slice(0, 3).map((c) => (
              <span key={c.id} className="rounded-md bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                {c.label}: {c.score}%
              </span>
            ))}
          </div>
        </div>
      )}
      {(engine || prompt || warnings.length > 0) && (
        <div className="rounded-xl border border-accent-500/25 bg-accent-500/8 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-accent-400">
            Dashboard Planner
            <span className="rounded-full bg-inset px-1.5 py-px text-[9.5px] text-muted">{engine ? `${engine} · local` : "deterministic fallback"}</span>
          </div>
          {prompt && <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">Prompt: {prompt}</p>}
          <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">
            {engine && engine !== "playbook"
              ? "Ollama refined wording, order, and explanation; the validated telecom playbook controls the required KPI pack and widgets."
              : "Dashboard layout came from the validated telecom playbook for the confirmed business goal."}
          </p>
          {warnings.map((w, i) => (
            <p key={`${w.severity}-${i}`} className={`mt-1.5 text-[11.5px] leading-relaxed ${w.severity === "critical" ? "text-critical-500" : w.severity === "warning" ? "text-warning-500" : "text-info-500"}`}>
              {w.message}
            </p>
          ))}
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => (
          <div key={`${r.persona}-${r.widgetTitle}`} className="rounded-xl border border-subtle bg-surface-2 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent-400">{r.widgetTitle}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{r.reason}</p>
            {r.sourceColumns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.sourceColumns.slice(0, 4).map((c) => (
                  <span key={c} className="rounded-md bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center">
      <p className="text-[12px] text-muted">{msg}</p>
    </div>
  );
}
