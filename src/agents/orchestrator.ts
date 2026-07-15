import { sleep, titleCase } from "@/lib/format";
import type { AgentProgressEvent, AnalysisResult, ColumnProfile, DashboardPlanWarning, DataUnderstandingReport, Dataset, FilterState, LlmDashboardPlan, SemanticMapping, TelecomBusinessContext } from "@/lib/types";
import { profileDataset, toEpoch, toNum } from "./profiling";
import { detectDomains, isTelecomDomain } from "./domainDetection";
import type { AssistOutcome } from "@/llm/mappingAssist";
import { needsAssist } from "@/llm/mappingAssist";
import { extractFrame } from "./frame";
import { computeIntelligence } from "./telecomIntelligence";
import { computeStatistics } from "./statistics";
import { computeForecasts } from "./forecasting";
import { computeRootCauses } from "./rootCause";
import { discoverKpis } from "./kpiDiscovery";
import { composeStory } from "./storytelling";
import { designDashboards } from "./dashboardDesign";
import { computeGeospatial } from "./geospatial";

/* ------------------------------------------------------------------------
 * Pipeline orchestrator — runs Agents 2..12 over an ingested dataset.
 * `theatrical` paces the run so the user can watch each agent work;
 * silent mode (filter changes) runs the same pipeline instantly.
 * ---------------------------------------------------------------------- */

export interface PipelineOptions {
  onProgress?: (e: AgentProgressEvent) => void;
  theatrical?: boolean;
  /** LLM data-understanding hook — remaps/reshapes hard-to-parse uploads */
  assist?: (dataset: Dataset, profile: ColumnProfile[]) => Promise<AssistOutcome | null>;
  /** called when the assist replaced the dataset (store should keep the new one) */
  onDatasetTransformed?: (ds: Dataset) => void;
  /** user-reviewed profile/mapping from the Data Understanding step */
  understanding?: DataUnderstandingReport;
  /** reuse a confirmed mapping when the same dataset is re-run through filters */
  confirmedMapping?: SemanticMapping;
  /** validated local-LLM dashboard plan */
  dashboardPlan?: LlmDashboardPlan;
  /** visible warnings when dashboard planning fell back */
  dashboardPlanWarnings?: DashboardPlanWarning[];
  /** selected telecom business case, preserved for filtered refreshes */
  businessContext?: TelecomBusinessContext;
}

export function applyFilters(dataset: Dataset, filters: FilterState, mapping: { timestamp?: string; region?: string; technology?: string; entity?: string }): Dataset {
  const { dateStart, dateEnd, regions, technology, search } = filters;
  const noTime = dateStart === null && dateEnd === null;
  const noRegion = regions.length === 0;
  if (noTime && noRegion && !technology && !search.trim()) return dataset;

  const searchLower = search.trim().toLowerCase();
  const rows = dataset.rows.filter((r) => {
    if (!noTime && mapping.timestamp) {
      const t = toEpoch(r[mapping.timestamp]);
      if (t !== null) {
        if (dateStart !== null && t < dateStart) return false;
        if (dateEnd !== null && t > dateEnd + 24 * 3600_000) return false;
      }
    }
    if (!noRegion && mapping.region) {
      const reg = String(r[mapping.region] ?? "");
      if (!regions.includes(reg)) return false;
    }
    if (technology && mapping.technology) {
      if (String(r[mapping.technology] ?? "") !== technology) return false;
    }
    if (searchLower && mapping.entity) {
      if (!String(r[mapping.entity] ?? "").toLowerCase().includes(searchLower)) return false;
    }
    return true;
  });
  return { ...dataset, rows, rowCount: rows.length };
}

export async function runPipeline(dataset: Dataset, opts: PipelineOptions = {}): Promise<AnalysisResult> {
  const { onProgress, theatrical } = opts;
  const t0 = performance.now();
  const emit = (agentKey: string, status: AgentProgressEvent["status"], note?: string) =>
    onProgress?.({ agentKey, status, note });
  const pace = async (ms: number) => {
    if (theatrical) await sleep(ms);
  };

  emit("ingestion", "running", `Normalizing ${dataset.rowCount.toLocaleString()} rows`);
  await pace(420);
  emit("ingestion", "done", `${dataset.rowCount.toLocaleString()} rows · ${dataset.columns.length} columns`);

  emit("profiling", "running", "Inferring column roles and semantics");
  await pace(80);
  let { dataset: ds, profile, mapping } = opts.understanding
    ? { dataset: opts.understanding.dataset, profile: opts.understanding.profile, mapping: opts.understanding.mapping }
    : profileDataset(dataset);
  if (opts.confirmedMapping) mapping = opts.confirmedMapping;
  emit(
    "profiling",
    "done",
    `${profile.filter((p) => p.role === "numeric").length} measures · ${profile.filter((p) => p.role === "datetime").length} time columns`
  );
  await pace(420);

  emit("domain", "running", "Matching domain signatures");
  let domains = detectDomains(profile, mapping);
  let transformNote = opts.understanding?.transformNote;

  // LLM data-understanding: triggered only when the heuristics are uncertain
  if (!opts.understanding && opts.assist && needsAssist(mapping, domains)) {
    emit("domain", "running", "Local LLM analyzing the data structure…");
    try {
      const outcome = await opts.assist(ds, profile);
      if (outcome) {
        ds = outcome.dataset;
        profile = outcome.profile;
        mapping = outcome.mapping;
        transformNote = outcome.note;
        domains = detectDomains(profile, mapping);
        opts.onDatasetTransformed?.(ds);
      }
    } catch {
      // assist is best-effort; heuristic result stands
    }
  }
  const isTelecom = isTelecomDomain(domains);
  const businessContext = opts.understanding?.businessContext ?? opts.businessContext;
  emit("domain", "done", transformNote ? `${domains[0].domain} ${domains[0].confidence}% · LLM-assisted` : `${domains[0].domain} ${domains[0].confidence}%`);
  await pace(500);

  const frame = extractFrame(ds, mapping, businessContext);
  const measureIsPct = isTelecom && !!mapping.utilization;
  const measureLabel = measureIsPct ? "Utilization" : titleCase(mapping.primaryMeasure ?? "Value");

  emit("telecom", "running", "Scanning for congestion and saturation");
  await pace(150);
  const intel = computeIntelligence(frame, mapping, isTelecom);
  const geo = computeGeospatial(frame, intel.entityStats);
  emit(
    "telecom",
    isTelecom ? "done" : "skipped",
    isTelecom
      ? `${intel.congestionEvents.length.toLocaleString()} congestion events · ${intel.entityStats.filter((e) => e.chronic).length} chronic`
      : "Non-telecom dataset — generic analytics path"
  );
  await pace(520);

  emit("kpi", "running", "Deriving KPI catalog");
  const kpis = discoverKpis(
    frame,
    intel.entityStats,
    intel.regionStats,
    intel.congestionEvents,
    intel.healthScore,
    isTelecom,
    !!mapping.measureHigherIsBad,
    businessContext
  );
  emit("kpi", "done", `${kpis.length} KPIs discovered`);
  await pace(460);

  emit("stats", "running", "Trends, correlations, anomaly scan");
  const stats = computeStatistics(frame);
  emit("stats", "done", `${stats.anomalies.length} anomalies · ${stats.correlations.length} correlations`);
  await pace(480);

  emit("forecast", "running", "Projecting utilization and traffic");
  const fc = computeForecasts(frame, intel.regionStats, intel.entityStats, isTelecom);
  const sat = fc.forecasts.find((f) => f.saturationDate !== null);
  emit("forecast", fc.forecasts.length ? "done" : "skipped", sat ? `Saturation risk detected` : `${fc.forecasts.length} forecast series`);
  await pace(480);

  emit("rca", "running", "Building causal chains");
  const rootCauses = isTelecom
    ? computeRootCauses(frame, intel.entityStats, intel.regionStats, intel.congestionEvents, stats.anomalies, stats.correlations)
    : [];
  emit("rca", isTelecom ? "done" : "skipped", isTelecom ? `${rootCauses.length} root-cause hypotheses` : "Generic dataset");
  await pace(460);

  emit("story", "running", "Writing executive narrative");
  const { story, insights } = composeStory(
    frame,
    domains,
    kpis,
    intel.entityStats,
    intel.regionStats,
    intel.congestionEvents,
    stats.anomalies,
    rootCauses,
    fc.forecasts,
    intel.healthScore,
    measureIsPct,
    !!mapping.measureHigherIsBad && !measureIsPct,
    businessContext
  );
  emit("story", "done", "Narrative + insight feed ready");
  await pace(420);

  emit("design", "running", "Composing persona dashboards");
  const designed = designDashboards({
    isTelecom,
    measureIsPct,
    measureLabel,
    measureHigherIsBad: !!mapping.measureHigherIsBad && !measureIsPct,
    mapping,
    profile,
    kpis,
    heatmap: intel.heatmap,
    dailyTrend: intel.dailyTrend,
    forecasts: fc.forecasts,
    sankey: intel.sankey,
    regionStats: intel.regionStats,
    entityStats: intel.entityStats,
    anomalies: stats.anomalies,
    busyHourProfile: intel.busyHourProfile,
    distribution: intel.distribution,
    correlations: stats.correlations,
    congestionEvents: intel.congestionEvents,
    topEntityDaily: intel.topEntityDaily,
    geoSites: geo.sites,
    dashboardPlan: opts.dashboardPlan,
  });
  const { dashboards, reasoning: dashboardReasoning } = designed;
  emit("design", "done", `${dashboards.length} dashboards · ${dashboards.reduce((s, d) => s + d.widgets.length, 0)} widgets`);
  await pace(440);

  emit("report", "done", "PDF / PPTX / Excel channels armed");
  await pace(260);
  emit("chat", "done", "Assistant indexed the results");
  await pace(200);
  return {
    datasetId: ds.id,
    datasetName: ds.name,
    generatedAt: Date.now(),
    durationMs: Math.round(performance.now() - t0),
    rowsAnalyzed: ds.rowCount,
    isTelecom,
    domains,
    profile,
    mapping,
    timeRange: frame.hasTime
      ? {
          start: frame.timeStart,
          end: frame.timeEnd,
          days: Math.max(1, Math.round((frame.timeEnd - frame.timeStart) / (24 * 3600_000))),
        }
      : null,
    kpis,
    entityStats: intel.entityStats,
    topEntities: intel.entityStats.slice(0, 25),
    regionStats: intel.regionStats,
    congestionEvents: intel.congestionEvents,
    busyHourProfile: intel.busyHourProfile,
    heatmap: intel.heatmap,
    dailyTrend: intel.dailyTrend,
    forecasts: fc.forecasts,
    anomalies: stats.anomalies,
    correlations: stats.correlations,
    rootCauses,
    insights,
    story,
    dashboards,
    dashboardReasoning,
    dashboardPlan: opts.dashboardPlan,
    dashboardPlanPrompt: opts.dashboardPlan?.prompt,
    dashboardPlanEngine: opts.dashboardPlan?.engine,
    dashboardPlanWarnings: [...(opts.dashboardPlan?.warnings ?? []), ...(opts.dashboardPlanWarnings ?? [])],
    businessContext,
    businessStatusBreakdown: buildBusinessStatusBreakdown(ds, businessContext, mapping),
    geoSites: geo.sites,
    geoQuality: geo.quality,
    distribution: intel.distribution,
    sankey: intel.sankey,
    healthScore: intel.healthScore,
    measureLabel,
    measureIsPct,
    measureHigherIsBad: !!mapping.measureHigherIsBad && !measureIsPct,
    transformNote,
    topEntityDaily: intel.topEntityDaily,
  };
}

function buildBusinessStatusBreakdown(
  dataset: Dataset,
  businessContext: TelecomBusinessContext | undefined,
  mapping: SemanticMapping
): AnalysisResult["businessStatusBreakdown"] {
  const col = businessContext?.statusColumn;
  if (!col || !dataset.columns.includes(col)) return [];
  const byStatus = new Map<string, { count: number; subscribers: number }>();
  for (const row of dataset.rows) {
    const label = String(row[col] ?? "Unknown").trim() || "Unknown";
    const cur = byStatus.get(label) ?? { count: 0, subscribers: 0 };
    cur.count++;
    if (mapping.subscribers) cur.subscribers += toNum(row[mapping.subscribers]) ?? 0;
    byStatus.set(label, cur);
  }
  const total = Math.max(1, dataset.rows.length);
  return [...byStatus.entries()]
    .map(([label, v]) => ({
      label,
      count: v.count,
      sharePct: (v.count / total) * 100,
      subscribersImpacted: v.subscribers,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}
