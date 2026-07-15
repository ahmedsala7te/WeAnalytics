import type { AnalysisResult, DashboardReason, DashboardSpec, LlmDashboardPlan, PersonaId, WidgetSpec } from "@/lib/types";
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
  | "geoSites"
  | "mapping"
  | "profile"
> & { measureIsPct: boolean; measureLabel: string; measureHigherIsBad: boolean; dashboardPlan?: LlmDashboardPlan };

interface DashboardDesignResult {
  dashboards: DashboardSpec[];
  reasoning: DashboardReason[];
}

function w(type: WidgetSpec["type"], title: string, span: 1 | 2 | 3 | 4, extra?: Partial<WidgetSpec>): WidgetSpec {
  return { id: uid("w"), type, title, span, ...extra };
}

function cols(...names: (string | undefined)[]): string[] {
  return names.filter((n): n is string => !!n);
}

function addWidget(
  widgets: WidgetSpec[],
  reasoning: DashboardReason[],
  persona: PersonaId | "overview",
  type: WidgetSpec["type"],
  title: string,
  span: 1 | 2 | 3 | 4,
  reason: string,
  sourceColumns: string[],
  extra?: Partial<WidgetSpec>
) {
  widgets.push(w(type, title, span, extra));
  reasoning.push({ persona, widgetTitle: title, reason, sourceColumns });
}

export function designDashboards(a: Art): DashboardDesignResult {
  const hasRegions = a.regionStats.length > 1;
  const hasTrend = !!a.dailyTrend;
  const hasForecast = a.forecasts.length > 0;
  const hasHeatmap = !!a.heatmap;
  const hasBusyHour = a.busyHourProfile.length === 24;
  const hasAnomalies = a.anomalies.length > 0;
  const hasSankey = !!a.sankey && a.sankey.links.length > 2;
  const hasGeo = a.geoSites.length > 0;
  const hasAlarms = a.kpis.some((k) => k.name === "Alarm Volume");
  const peakForecastIdx = Math.max(0, a.forecasts.findIndex((f) => f.name.includes("peak")));
  const reasoning: DashboardReason[] = [];

  if (a.dashboardPlan && a.dashboardPlan.widgets.length > 0) {
    return {
      dashboards: [
        {
          persona: a.dashboardPlan.persona,
          title: a.dashboardPlan.title,
          description: a.dashboardPlan.description,
          widgets: a.dashboardPlan.widgets,
        },
      ],
      reasoning: [
        {
          persona: a.dashboardPlan.persona,
          widgetTitle: "Dashboard Intent",
          reason: a.dashboardPlan.rawIntent ?? `Planned from the user prompt: ${a.dashboardPlan.prompt || "automatic dashboard"}.`,
          sourceColumns: [],
        },
        ...a.dashboardPlan.reasoning,
      ],
    };
  }

  // Measure-mode overview: non-telecom data OR telecom data without a
  // utilization percentage (assurance reports, alarm extracts, KPI lists…)
  if (!a.isTelecom || !a.measureIsPct) {
    const label = a.measureLabel;
    const bad = a.measureHigherIsBad;
    const hasSubs = a.entityStats.some((e) => (e.subscribers ?? 0) > 0);
    const hasEntities = a.entityStats.length > 1;
    const widgets: WidgetSpec[] = [];
    addWidget(
      widgets,
      reasoning,
      "overview",
      "kpi-grid",
      "Key Performance Indicators",
      4,
      "The profiler found numeric measures, so the dashboard starts with the most useful automatically derived KPIs.",
      cols(a.mapping.primaryMeasure, ...a.mapping.measures.slice(0, 4)),
      { dataKey: "generic" }
    );
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "overview" }));
    if (hasTrend) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "trend",
        `${label} Trend`,
        hasRegions || hasEntities ? 2 : 4,
        "A timestamp column was detected, so a time trend helps show whether the main measure is improving or worsening.",
        cols(a.mapping.timestamp, a.mapping.primaryMeasure),
        { dataKey: "regions" }
      );
    }
    // segment mix: subscribers by segment when present, else the measure
    if (hasEntities && hasSubs) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "pareto",
        "Subscribers by Segment",
        2,
        "Subscriber counts were detected, so segment mix is shown separately from the primary measure.",
        cols(a.mapping.entity, a.mapping.subscribers),
        { dataKey: "subscribers" }
      );
    }
    if (hasRegions) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "table-regions",
        "Regional Breakdown",
        2,
        "A region/grouping column was detected, so the dashboard compares performance across groups.",
        cols(a.mapping.region, a.mapping.primaryMeasure)
      );
    }
    // short multi-period reports: per-element daily comparison (grouped bars)
    if (a.topEntityDaily.length > 1 && (a.topEntityDaily[0]?.points.length ?? 0) <= 7) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "entity-bars",
        `${label} by Element — Daily Comparison`,
        4,
        "The data has a short time window and multiple entities, so grouped bars make day-by-day comparison easier than a dense line chart.",
        cols(a.mapping.timestamp, a.mapping.entity, a.mapping.primaryMeasure)
      );
    }
    addWidget(
      widgets,
      reasoning,
      "overview",
      "pareto",
      `Top Segments by ${label}`,
      2,
      "A breakdown dimension was detected, so the dashboard ranks the largest or worst contributors.",
      cols(a.mapping.entity, a.mapping.primaryMeasure),
      { dataKey: "measure" }
    );
    if (a.distribution) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "histogram",
        `${label} Distribution`,
        2,
        "A numeric primary measure was available, so distribution reveals spread, outliers, and concentration.",
        cols(a.mapping.primaryMeasure)
      );
    }
    addWidget(
      widgets,
      reasoning,
      "overview",
      "table-entities",
      bad ? `Worst Elements — ${label}` : hasSubs ? "Segment Breakdown" : `Top Segments — ${label}`,
      hasRegions && a.distribution ? 4 : 2,
      bad
        ? "The selected measure behaves like a badness indicator, so entities are ranked by risk."
        : "The dashboard includes a detailed table so users can verify the ranked segments behind the charts.",
      cols(a.mapping.entity, a.mapping.region, a.mapping.primaryMeasure),
      { dataKey: bad ? "risk" : "breakdown" }
    );
    if (hasForecast) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "forecast",
        `${label} Forecast`,
        4,
        "Enough time history was available to project the primary measure forward.",
        cols(a.mapping.timestamp, a.mapping.primaryMeasure),
        { dataKey: "0" }
      );
    }
    if (hasAnomalies) {
      addWidget(
        widgets,
        reasoning,
        "overview",
        "anomalies",
        "Detected Anomalies",
        2,
        "The statistics agent found values that deviated from expected behavior.",
        cols(a.mapping.timestamp, a.mapping.primaryMeasure)
      );
    }
    addWidget(
      widgets,
      reasoning,
      "overview",
      "insights",
      "AI Insights",
      hasAnomalies ? 2 : 4,
      "The insight feed summarizes the strongest findings, risks, and recommended next actions from the computed analysis.",
      cols(a.mapping.primaryMeasure),
      { tall: true }
    );
    return {
      dashboards: [
        {
          persona: "overview",
          title: a.isTelecom ? "Network Report" : "Overview",
          description: "Auto-generated analytics for this dataset",
          widgets,
        },
      ],
      reasoning,
    };
  }

  const dashboards: DashboardSpec[] = [];

  /* ------------------------------ Executive ------------------------------ */
  {
    const widgets: WidgetSpec[] = [
      w("kpi-grid", "Executive KPIs", 3, { dataKey: "executive" }),
      w("gauge", "Network Health", 1),
    ];
    reasoning.push(
      { persona: "executive", widgetTitle: "Executive KPIs", reason: "Telecom utilization semantics were detected, so executive KPIs lead with health, risk, congestion, and growth.", sourceColumns: cols(a.mapping.utilization, a.mapping.traffic, a.mapping.subscribers) },
      { persona: "executive", widgetTitle: "Network Health", reason: "A utilization percentage was confirmed, so the composite health score is valid for this dataset.", sourceColumns: cols(a.mapping.utilization, a.mapping.alarms, a.mapping.availability) }
    );
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "executive" }));
    if (hasRegions) addWidget(widgets, reasoning, "executive", "tilemap", "Regional Health Map", 4, "A region column was detected, so executives can see where risk is concentrated.", cols(a.mapping.region, a.mapping.utilization), { subtitle: "Click a region to filter the workspace" });
    if (hasGeo) addWidget(widgets, reasoning, "executive", "geo-map-3d", "Egypt Network Digital Twin", 4, "Valid latitude and longitude columns were detected, so network risk can be explored in its real geographic context.", cols(a.mapping.latitude, a.mapping.longitude, a.mapping.entity, a.mapping.utilization), { tall: true, subtitle: "3D sites, risk columns and density layers · click a site to investigate" });
    if (hasTrend) addWidget(widgets, reasoning, "executive", "trend", "Congestion & Utilization Trend", hasForecast ? 2 : 4, "A timestamp column was detected, so trend confirms whether congestion pressure is rising or falling.", cols(a.mapping.timestamp, a.mapping.utilization), { dataKey: "regions" });
    if (hasForecast) addWidget(widgets, reasoning, "executive", "forecast", "Capacity Forecast", 2, "Enough history exists to forecast saturation risk from the utilization trend.", cols(a.mapping.timestamp, a.mapping.utilization), { dataKey: String(peakForecastIdx) });
    addWidget(widgets, reasoning, "executive", "insights", "AI Insights & Strategic Recommendations", hasSankey ? 2 : 4, "Insights convert the computed KPIs, risks, forecasts, and root causes into executive actions.", cols(a.mapping.utilization, a.mapping.alarms), { tall: true });
    if (hasSankey) addWidget(widgets, reasoning, "executive", "sankey", "Traffic Flow by Health State", 2, "Traffic and health-state data were available, so flow helps explain where load sits across risk states.", cols(a.mapping.traffic, a.mapping.utilization), { tall: true });
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
    reasoning.push({ persona: "noc", widgetTitle: "Live Network Status", reason: "NOC view prioritizes live congestion, alarms, and availability-style KPIs.", sourceColumns: cols(a.mapping.utilization, a.mapping.alarms, a.mapping.availability) });
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "noc" }));
    if (hasHeatmap) addWidget(widgets, reasoning, "noc", "heatmap", "Congestion Heatmap — Region × Hour", 4, "Hourly utilization and region data were detected, so a heatmap highlights recurring busy periods.", cols(a.mapping.timestamp, a.mapping.region, a.mapping.utilization), { tall: true });
    if (hasGeo) addWidget(widgets, reasoning, "noc", "geo-map-3d", "Live Egypt Operations Map", 4, "Coordinates were detected, so the NOC can move from regional symptoms to the exact affected network elements.", cols(a.mapping.latitude, a.mapping.longitude, a.mapping.entity, a.mapping.alarms), { tall: true });
    addWidget(widgets, reasoning, "noc", "table-entities", "Critical Elements — Highest Risk Now", 2, "The entity table exposes the exact elements driving operational risk.", cols(a.mapping.entity, a.mapping.region, a.mapping.utilization), { dataKey: "risk", tall: true });
    if (hasAnomalies) addWidget(widgets, reasoning, "noc", "anomalies", "Anomalies & Alarm Storms", 2, "Anomalies were detected, so the NOC dashboard surfaces incident signatures.", cols(a.mapping.timestamp, a.mapping.alarms, a.mapping.utilization), { tall: true });
    if (hasTrend && hasAlarms) addWidget(widgets, reasoning, "noc", "area-trend", "Alarm Trend", 2, "Alarm data and time history were detected, so alarm trend is shown for operations follow-up.", cols(a.mapping.timestamp, a.mapping.alarms), { dataKey: "alarms" });
    if (hasBusyHour) addWidget(widgets, reasoning, "noc", "busy-hour", "24-Hour Load Profile", 2, "Hourly timestamps were detected, so the dashboard identifies the network busy-hour pattern.", cols(a.mapping.timestamp, a.mapping.utilization));
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
    reasoning.push({ persona: "capacity", widgetTitle: "Capacity KPIs", reason: "Capacity view prioritizes headroom, chronic congestion, growth, and saturation risk.", sourceColumns: cols(a.mapping.utilization, a.mapping.capacity, a.mapping.traffic) });
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "capacity" }));
    if (hasForecast) addWidget(widgets, reasoning, "capacity", "forecast", "Saturation Forecast", hasRegions ? 2 : 4, "Enough time history exists to estimate when high-risk elements may reach saturation.", cols(a.mapping.timestamp, a.mapping.utilization), { dataKey: String(peakForecastIdx) });
    if (hasGeo) addWidget(widgets, reasoning, "capacity", "geo-map-3d", "Geographic Expansion Priorities", 4, "Coordinates were detected, so capacity investment priorities can be viewed by their physical concentration.", cols(a.mapping.latitude, a.mapping.longitude, a.mapping.entity, a.mapping.capacity), { tall: true });
    addWidget(widgets, reasoning, "capacity", "scatter", "Expansion Priority Quadrant", 2, "Element-level utilization and growth were computed, so the quadrant ranks expansion priorities.", cols(a.mapping.entity, a.mapping.utilization, a.mapping.subscribers), { subtitle: "p95 utilization vs growth — bubble = subscribers" });
    addWidget(widgets, reasoning, "capacity", "table-entities", "Expansion Priorities", hasRegions ? 2 : 4, "The table lists the concrete elements behind capacity risk and forecast dates.", cols(a.mapping.entity, a.mapping.region, a.mapping.utilization), { dataKey: "saturation", tall: true });
    if (hasRegions) addWidget(widgets, reasoning, "capacity", "treemap", "Capacity Risk by Region", 2, "Region data was detected, so regional treemap summarizes where investment pressure is concentrated.", cols(a.mapping.region, a.mapping.utilization), { tall: true });
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
    reasoning.push({ persona: "performance", widgetTitle: "Performance KPIs", reason: "Performance view focuses on utilization, congestion, busy hour, latency, and packet-loss KPIs when present.", sourceColumns: cols(a.mapping.utilization, a.mapping.latency, a.mapping.packetLoss) });
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "performance" }));
    if (hasTrend) addWidget(widgets, reasoning, "performance", "trend", "Utilization Trend by Region", 4, "A timestamp column was detected, so utilization trend shows performance movement over time.", cols(a.mapping.timestamp, a.mapping.region, a.mapping.utilization), { dataKey: "regions" });
    addWidget(widgets, reasoning, "performance", "pareto", "Top Congested Elements", 2, "The dashboard ranks elements by congestion so performance issues are easy to prioritize.", cols(a.mapping.entity, a.mapping.utilization), { dataKey: "congestion" });
    if (a.distribution) addWidget(widgets, reasoning, "performance", "histogram", "Utilization Distribution", 2, "Distribution shows whether load is broadly healthy or concentrated near critical thresholds.", cols(a.mapping.utilization));
    if (hasBusyHour) addWidget(widgets, reasoning, "performance", "busy-hour", "Busy-Hour Profile", 2, "Hourly data was detected, so the busy-hour profile identifies recurring load peaks.", cols(a.mapping.timestamp, a.mapping.utilization));
    if (a.correlations.length > 0) addWidget(widgets, reasoning, "performance", "correlation", "Metric Correlations", 2, "Multiple numeric measures were detected, so correlations help explain linked degradation patterns.", a.mapping.measures.slice(0, 6));
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
    reasoning.push({ persona: "assurance", widgetTitle: "Service Assurance KPIs", reason: "Assurance view prioritizes alarms, critical incidents, availability, SLA, and subscriber impact when available.", sourceColumns: cols(a.mapping.alarms, a.mapping.criticalAlarms, a.mapping.availability, a.mapping.subscribers) });
    widgets.push(w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: "assurance" }));
    if (hasTrend && hasAlarms) addWidget(widgets, reasoning, "assurance", "area-trend", "Alarm Volume Trend", hasAnomalies ? 2 : 4, "Alarm counts and timestamps were detected, so alarm trend supports incident review.", cols(a.mapping.timestamp, a.mapping.alarms), { dataKey: "alarms" });
    if (hasAnomalies) addWidget(widgets, reasoning, "assurance", "anomalies", "Incident Signatures", 2, "The anomaly scan found incident-like patterns worth assurance review.", cols(a.mapping.timestamp, a.mapping.alarms, a.mapping.availability), { tall: true });
    if (hasRegions) addWidget(widgets, reasoning, "assurance", "table-regions", "Regional SLA & Impact", 4, "Region data was detected, so assurance impact is compared by region.", cols(a.mapping.region, a.mapping.availability, a.mapping.subscribers));
    addWidget(widgets, reasoning, "assurance", "insights", "Service Impact Assessment", 4, "Insights summarize customer/service impact and operational recommendations from the computed findings.", cols(a.mapping.alarms, a.mapping.availability, a.mapping.subscribers));
    dashboards.push({
      persona: "assurance",
      title: "Service Assurance",
      description: "Alarms, SLA compliance and service impact",
      widgets,
    });
  }

  return { dashboards, reasoning };
}
