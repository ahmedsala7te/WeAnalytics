import type { AnalysisResult, DashboardSpec, WidgetSpec } from "@/lib/types";
import { uid } from "@/lib/format";

/* ------------------------------------------------------------------------
 * Agent 9 — Dashboard Design
 * Composes persona-specific bento dashboards from available artifacts.
 * Widgets are only included when their backing data exists.
 * ---------------------------------------------------------------------- */

type Art = Pick<
  AnalysisResult,
  | "isTelecom"
  | "kpis"
  | "heatmap"
  | "dailyTrend"
  | "forecasts"
  | "sankey"
  | "regionStats"
  | "entityStats"
  | "anomalies"
  | "busyHourProfile"
  | "distribution"
  | "correlations"
  | "congestionEvents"
  | "topEntityDaily"
> & { measureIsPct: boolean; measureLabel: string; measureHigherIsBad: boolean };

function w(type: WidgetSpec["type"], title: string, span: 1 | 2 | 3 | 4, extra?: Partial<WidgetSpec>): WidgetSpec {
  return { id: uid("w"), type, title, span, ...extra };
}

export function designDashboards(a: Art): DashboardSpec[] {
  const hasRegions = a.regionStats.length > 1;
  const hasTrend = !!a.dailyTrend;
  const hasForecast = a.forecasts.length > 0;
  const hasHeatmap = !!a.heatmap;
  const hasBusyHour = a.busyHourProfile.length === 24;
  const hasAnomalies = a.anomalies.length > 0;
  const hasSankey = !!a.sankey && a.sankey.links.length > 2;
  const hasAlarms = a.kpis.some((k) => k.name === "Alarm Volume");
  const peakForecastIdx = Math.max(0, a.forecasts.findIndex((f) => f.name.includes("peak")));

  // Measure-mode overview: non-telecom data OR telecom data without a
  // utilization percentage (assurance reports, alarm extracts, KPI lists…)
  if (!a.isTelecom || !a.measureIsPct) {
    const label = a.measureLabel;
    const bad = a.measureHigherIsBad;
    const hasSubs = a.entityStats.some((e) => (e.subscribers ?? 0) > 0);
    const hasEntities = a.entityStats.length > 1;
    const widgets: WidgetSpec[] = [w("kpi-grid", "Key Performance Indicators", 4, { dataKey: "generic" })];
    if (hasTrend) widgets.push(w("trend", `${label} Trend`, hasRegions || hasEntities ? 2 : 4, { dataKey: "regions" }));
    // segment mix: subscribers by segment when present, else the measure
    if (hasEntities && hasSubs) widgets.push(w("pareto", "Subscribers by Segment", 2, { dataKey: "subscribers" }));
    if (hasRegions) widgets.push(w("table-regions", "Regional Breakdown", 2));
    // short multi-period reports: per-element daily comparison (grouped bars)
    if (a.topEntityDaily.length > 1 && (a.topEntityDaily[0]?.points.length ?? 0) <= 7) {
      widgets.push(w("entity-bars", `${label} by Element — Daily Comparison`, 4));
    }
    widgets.push(w("pareto", `Top Segments by ${label}`, 2, { dataKey: "measure" }));
    if (a.distribution) widgets.push(w("histogram", `${label} Distribution`, 2));
    widgets.push(
      w(
        "table-entities",
        bad ? `Worst Elements — ${label}` : hasSubs ? "Segment Breakdown" : `Top Segments — ${label}`,
        hasRegions && a.distribution ? 4 : 2,
        { dataKey: bad ? "risk" : "breakdown" }
      )
    );
    if (hasForecast) widgets.push(w("forecast", `${label} Forecast`, 4, { dataKey: "0" }));
    if (hasAnomalies) widgets.push(w("anomalies", "Detected Anomalies", 2));
    widgets.push(w("insights", "AI Insights", hasAnomalies ? 2 : 4, { tall: true }));
    return [
      {
        persona: "overview",
        title: a.isTelecom ? "Network Report" : "Overview",
        description: "Auto-generated analytics for this dataset",
        widgets,
      },
    ];
  }

  const dashboards: DashboardSpec[] = [];

  /* ------------------------------ Executive ------------------------------ */
  {
    const widgets: WidgetSpec[] = [
      w("kpi-grid", "Executive KPIs", 3, { dataKey: "executive" }),
      w("gauge", "Network Health", 1),
    ];
    if (hasRegions) widgets.push(w("tilemap", "Regional Health Map", 4, { subtitle: "Click a region to filter the workspace" }));
    if (hasTrend) widgets.push(w("trend", "Congestion & Utilization Trend", hasForecast ? 2 : 4, { dataKey: "regions" }));
    if (hasForecast) widgets.push(w("forecast", "Capacity Forecast", 2, { dataKey: String(peakForecastIdx) }));
    widgets.push(w("insights", "AI Insights & Strategic Recommendations", hasSankey ? 2 : 4, { tall: true }));
    if (hasSankey) widgets.push(w("sankey", "Traffic Flow by Health State", 2, { tall: true }));
    dashboards.push({
      persona: "executive",
      title: "CTO / Executive",
      description: "Strategic health, risk and investment priorities",
      widgets,
    });
  }

  /* --------------------------------- NOC --------------------------------- */
  {
    const widgets: WidgetSpec[] = [w("kpi-grid", "Live Network Status", 4, { dataKey: "noc" })];
    if (hasHeatmap) widgets.push(w("heatmap", "Congestion Heatmap — Region × Hour", 4, { tall: true }));
    widgets.push(w("table-entities", "Critical Elements — Highest Risk Now", 2, { dataKey: "risk", tall: true }));
    if (hasAnomalies) widgets.push(w("anomalies", "Anomalies & Alarm Storms", 2, { tall: true }));
    if (hasTrend && hasAlarms) widgets.push(w("area-trend", "Alarm Trend", 2, { dataKey: "alarms" }));
    if (hasBusyHour) widgets.push(w("busy-hour", "24-Hour Load Profile", 2));
    dashboards.push({
      persona: "noc",
      title: "NOC Operations",
      description: "Active congestion, critical sites and alarm activity",
      widgets,
    });
  }

  /* ------------------------------- Capacity ------------------------------ */
  {
    const widgets: WidgetSpec[] = [w("kpi-grid", "Capacity KPIs", 4, { dataKey: "capacity" })];
    if (hasForecast) widgets.push(w("forecast", "Saturation Forecast", hasRegions ? 2 : 4, { dataKey: String(peakForecastIdx) }));
    widgets.push(w("scatter", "Expansion Priority Quadrant", 2, { subtitle: "p95 utilization vs growth — bubble = subscribers" }));
    widgets.push(w("table-entities", "Expansion Priorities", hasRegions ? 2 : 4, { dataKey: "saturation", tall: true }));
    if (hasRegions) widgets.push(w("treemap", "Capacity Risk by Region", 2, { tall: true }));
    dashboards.push({
      persona: "capacity",
      title: "Capacity Planning",
      description: "Growth, saturation forecasts and expansion ranking",
      widgets,
    });
  }

  /* ----------------------------- Performance ----------------------------- */
  {
    const widgets: WidgetSpec[] = [w("kpi-grid", "Performance KPIs", 4, { dataKey: "performance" })];
    if (hasTrend) widgets.push(w("trend", "Utilization Trend by Region", 4, { dataKey: "regions" }));
    widgets.push(w("pareto", "Top Congested Elements", 2, { dataKey: "congestion" }));
    if (a.distribution) widgets.push(w("histogram", "Utilization Distribution", 2));
    if (hasBusyHour) widgets.push(w("busy-hour", "Busy-Hour Profile", 2));
    if (a.correlations.length > 0) widgets.push(w("correlation", "Metric Correlations", 2));
    dashboards.push({
      persona: "performance",
      title: "Performance",
      description: "Traffic, utilization and degradation analysis",
      widgets,
    });
  }

  /* ------------------------------ Assurance ------------------------------ */
  {
    const widgets: WidgetSpec[] = [w("kpi-grid", "Service Assurance KPIs", 4, { dataKey: "assurance" })];
    if (hasTrend && hasAlarms) widgets.push(w("area-trend", "Alarm Volume Trend", hasAnomalies ? 2 : 4, { dataKey: "alarms" }));
    if (hasAnomalies) widgets.push(w("anomalies", "Incident Signatures", 2, { tall: true }));
    if (hasRegions) widgets.push(w("table-regions", "Regional SLA & Impact", 4));
    widgets.push(w("insights", "Service Impact Assessment", 4));
    dashboards.push({
      persona: "assurance",
      title: "Service Assurance",
      description: "Alarms, SLA compliance and service impact",
      widgets,
    });
  }

  return dashboards;
}
