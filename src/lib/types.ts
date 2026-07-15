/* ------------------------------------------------------------------ */
/* Core data model for the Network Intelligence Hub                    */
/* ------------------------------------------------------------------ */

export type CellValue = string | number | null;
export type Row = Record<string, CellValue>;

export type ColumnRole = "datetime" | "numeric" | "categorical" | "identifier" | "text";

export type SemanticTag =
  | "timestamp"
  | "utilization"
  | "traffic"
  | "capacity"
  | "region"
  | "city"
  | "latitude"
  | "longitude"
  | "entity"
  | "interface"
  | "subscribers"
  | "alarms"
  | "critical_alarms"
  | "availability"
  | "latency"
  | "packet_loss"
  | "technology"
  | "vendor"
  | "severity"
  | "revenue"
  | "quantity"
  | "measure"
  | "none";

export interface ColumnProfile {
  name: string;
  role: ColumnRole;
  semantic: SemanticTag;
  distinct: number;
  nullPct: number;
  samples: string[];
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  p95?: number;
}

export interface Dataset {
  id: string;
  name: string;
  source: "upload" | "sample" | "connector";
  fileType: string;
  uploadedAt: number;
  rowCount: number;
  columns: string[];
  rows: Row[];
  sizeBytes?: number;
}

export interface DatasetMeta {
  id: string;
  name: string;
  source: string;
  fileType: string;
  uploadedAt: number;
  rowCount: number;
  columns: number;
}

/* ------------------------------- Mapping -------------------------------- */

export interface SemanticMapping {
  timestamp?: string;
  entity?: string;
  region?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  utilization?: string;
  traffic?: string;
  capacity?: string;
  subscribers?: string;
  alarms?: string;
  criticalAlarms?: string;
  availability?: string;
  latency?: string;
  packetLoss?: string;
  technology?: string;
  vendor?: string;
  severity?: string;
  measures: string[];
  primaryMeasure?: string;
  /** true when larger primary-measure values are worse (critical minutes, alarms, loss…) */
  measureHigherIsBad?: boolean;
}

export type MappingOverrideField =
  | "timestamp"
  | "entity"
  | "region"
  | "latitude"
  | "longitude"
  | "technology"
  | "utilization"
  | "traffic"
  | "capacity"
  | "subscribers"
  | "alarms"
  | "criticalAlarms"
  | "primaryMeasure";

export interface DataUnderstandingWarning {
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface DataUnderstandingReport {
  dataset: Dataset;
  profile: ColumnProfile[];
  domains: DomainScore[];
  mapping: SemanticMapping;
  businessContext: TelecomBusinessContext;
  warnings: DataUnderstandingWarning[];
  transformed: boolean;
  transformNote?: string;
  quality: {
    rows: number;
    columns: number;
    numericColumns: number;
    datetimeColumns: number;
    categoricalColumns: number;
    identifierColumns: number;
    averageNullPct: number;
  };
}

/* -------------------- LLM data-understanding assist ---------------------- */

export interface UnpivotGroup {
  /** ISO date/datetime literal for this group of columns */
  timestampLiteral?: string;
  /** column whose per-row value provides the timestamp for this group */
  timestampColumn?: string;
  /** new measure name -> source wide column */
  measures: Record<string, string>;
}

export interface TransformPlan {
  domainHint?: string;
  mapping?: Partial<Record<
    "timestamp" | "entity" | "region" | "city" | "latitude" | "longitude" | "utilization" | "traffic" | "capacity" | "subscribers" | "alarms" | "criticalAlarms" | "availability" | "latency" | "packetLoss" | "technology" | "vendor" | "severity",
    string | null
  >>;
  unpivot?: { groups: UnpivotGroup[]; keepColumns: string[] } | null;
  primaryMeasure?: string;
  measureHigherIsBad?: boolean;
  utilizationScale?: "percent" | "fraction" | null;
  notes?: string;
}

export interface DomainScore {
  domain: string;
  confidence: number; // 0..100
}

/* --------------------------------- KPIs --------------------------------- */

export type KpiStatus = "healthy" | "watch" | "warning" | "critical";

export interface Kpi {
  id: string;
  name: string;
  category: "performance" | "capacity" | "assurance" | "executive" | "generic";
  businessCaseIds?: TelecomBusinessCaseId[];
  businessPriority?: number;
  value: number;
  unit: "%" | "count" | "Mbps" | "Gbps" | "days" | "score" | "ms" | "raw" | "pct/wk";
  previous?: number | null;
  changePct: number | null;
  goodWhen: "low" | "high" | "neutral";
  status: KpiStatus;
  spark: number[];
  description: string;
  formula: string;
}

/* ----------------------------- Intelligence ----------------------------- */

export interface CongestionEvent {
  entity: string;
  region: string;
  time: number;
  utilization: number;
  severity: "warning" | "critical";
}

export interface EntityStat {
  entity: string;
  region: string;
  technology?: string;
  vendor?: string;
  avgUtil: number;
  peakUtil: number;
  p95Util: number;
  congestedHours: number;
  congestedDays: number;
  chronic: boolean;
  growthPctPerWeek: number;
  trafficMbps?: number;
  capacityMbps?: number;
  subscribers?: number;
  alarmCount: number;
  riskScore: number;
  saturationDate: number | null;
}

export interface RegionStat {
  region: string;
  entities: number;
  avgUtil: number;
  peakUtil: number;
  p95Util: number;
  congestedEntities: number;
  chronicEntities: number;
  congestionEvents: number;
  alarmCount: number;
  criticalAlarms: number;
  availability: number | null;
  healthScore: number;
  riskScore: number;
  growthPctPerWeek: number;
  subscribersImpacted: number;
  trafficMbps: number;
}

export interface SeriesPoint {
  t: number;
  v: number;
}

export interface NamedSeries {
  name: string;
  points: SeriesPoint[];
}

export interface ForecastResult {
  name: string;
  unit: string;
  history: SeriesPoint[];
  forecast: SeriesPoint[];
  upper: SeriesPoint[];
  lower: SeriesPoint[];
  slopePerDay: number;
  saturationDate: number | null;
  saturationThreshold: number;
  method: string;
}

export interface Anomaly {
  time: number;
  entity?: string;
  region?: string;
  metric: string;
  value: number;
  expected: number;
  zScore: number;
  kind: "spike" | "drop" | "alarm_storm";
  severity: "info" | "warning" | "critical";
  text: string;
}

export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
  note: string;
}

export interface RootCauseReport {
  id: string;
  scope: string;
  what: string;
  why: string;
  affected: string[];
  impact: string;
  actions: string[];
  confidence: number;
}

export interface Insight {
  id: string;
  kind: "finding" | "root_cause" | "risk" | "recommendation" | "forecast" | "anomaly";
  severity: "info" | "success" | "warning" | "critical";
  title: string;
  body: string;
  priority: number;
}

export interface ExecutiveStory {
  headline: string;
  summary: string;
  keyInsights: string[];
  rootCauses: string[];
  risks: string[];
  recommendations: string[];
  /** "templates" (deterministic) or the local LLM model name that wrote it */
  generatedBy?: string;
}

/* ------------------------------ Dashboards ------------------------------ */

export type PersonaId = "executive" | "noc" | "capacity" | "performance" | "assurance" | "overview";

export type TelecomBusinessCaseId =
  | "critical_time_comparison"
  | "congestion_risk"
  | "capacity_upgrade"
  | "subscriber_impact"
  | "alarm_assurance"
  | "availability_degradation"
  | "region_performance"
  | "upgrade_followup"
  | "top_offenders"
  | "daily_exception";

export interface TelecomBusinessCaseCandidate {
  id: TelecomBusinessCaseId;
  label: string;
  score: number;
  reasons: string[];
}

export interface TelecomBusinessContext {
  selectedCaseId: TelecomBusinessCaseId;
  selectedLabel: string;
  candidates: TelecomBusinessCaseCandidate[];
  entityColumn?: string;
  regionColumn?: string;
  sectorColumn?: string;
  statusColumn?: string;
  subscriberColumn?: string;
  primaryMeasure?: string;
  comparisonMeasure?: string;
  warningMeasure?: string;
  hasTimeComparison: boolean;
}

export type WidgetType =
  | "kpi-grid"
  | "gauge"
  | "tilemap"
  | "geo-map-3d"
  | "trend"
  | "area-trend"
  | "heatmap"
  | "busy-hour"
  | "pareto"
  | "treemap"
  | "sankey"
  | "scatter"
  | "forecast"
  | "histogram"
  | "table-entities"
  | "table-regions"
  | "anomalies"
  | "insights"
  | "dashboard-reasoning"
  | "business-comparison-bars"
  | "business-delta-table"
  | "business-status-breakdown"
  | "correlation"
  | "entity-bars";

export interface WidgetSpec {
  id: string;
  type: WidgetType;
  title: string;
  subtitle?: string;
  span: 1 | 2 | 3 | 4;
  tall?: boolean;
  dataKey?: string;
  /** stable playbook handle used by LLM refinement patches */
  playbookKey?: string;
  /** top-N override for pareto / entity tables / entity-bars */
  limit?: number;
  /** kpi-grid: KPI names hidden from this grid (chat-edited) */
  excludeKpis?: string[];
  /** kpi-grid: KPI names appended beyond the default pick (chat-edited) */
  extraKpis?: string[];
}

export interface DashboardSpec {
  persona: PersonaId;
  title: string;
  description: string;
  widgets: WidgetSpec[];
}

export interface DashboardReason {
  persona: PersonaId | "all";
  widgetTitle: string;
  reason: string;
  sourceColumns: string[];
}

export interface DashboardPlanWarning {
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface LlmDashboardPlan {
  prompt: string;
  engine: string;
  businessCaseId?: TelecomBusinessCaseId;
  persona: PersonaId;
  title: string;
  description: string;
  widgets: WidgetSpec[];
  reasoning: DashboardReason[];
  warnings: DashboardPlanWarning[];
  rawIntent?: string;
}

/* ----------------------------- Analysis root ---------------------------- */

export interface HeatmapData {
  regions: string[];
  /** matrix[regionIdx][hour] = avg utilization */
  matrix: (number | null)[][];
}

export interface SankeyData {
  nodes: { name: string }[];
  links: { source: string; target: string; value: number }[];
}

export interface BusinessStatusItem {
  label: string;
  count: number;
  sharePct: number;
  subscribersImpacted: number;
}

export interface GeoSiteStat {
  entity: string;
  region: string;
  latitude: number;
  longitude: number;
  avgUtil: number;
  peakUtil: number;
  riskScore: number;
  alarmCount: number;
  subscribers: number;
  technology?: string;
  vendor?: string;
}

export interface GeoQuality {
  validRows: number;
  invalidRows: number;
  outsideEgyptRows: number;
  swappedCoordinates: boolean;
  duplicateSites: number;
}

export interface AnalysisResult {
  datasetId: string;
  datasetName: string;
  generatedAt: number;
  durationMs: number;
  rowsAnalyzed: number;
  isTelecom: boolean;
  domains: DomainScore[];
  profile: ColumnProfile[];
  mapping: SemanticMapping;
  timeRange: { start: number; end: number; days: number } | null;
  kpis: Kpi[];
  entityStats: EntityStat[];
  topEntities: EntityStat[];
  regionStats: RegionStat[];
  congestionEvents: CongestionEvent[];
  busyHourProfile: (number | null)[];
  heatmap: HeatmapData | null;
  dailyTrend: {
    overall: NamedSeries;
    byRegion: NamedSeries[];
    traffic?: NamedSeries;
  } | null;
  forecasts: ForecastResult[];
  anomalies: Anomaly[];
  correlations: CorrelationPair[];
  rootCauses: RootCauseReport[];
  insights: Insight[];
  story: ExecutiveStory;
  dashboards: DashboardSpec[];
  dashboardReasoning: DashboardReason[];
  dashboardPlan?: LlmDashboardPlan;
  dashboardPlanPrompt?: string;
  dashboardPlanEngine?: string;
  dashboardPlanWarnings?: DashboardPlanWarning[];
  businessContext?: TelecomBusinessContext;
  businessStatusBreakdown: BusinessStatusItem[];
  geoSites: GeoSiteStat[];
  geoQuality: GeoQuality | null;
  distribution: { bins: string[]; counts: number[]; metric: string } | null;
  sankey: SankeyData | null;
  /** Health score 0..100 */
  healthScore: number;
  /** Display label of the value the entity/region stats are built on */
  measureLabel: string;
  /** true when that value is a 0–100 percentage (utilization) */
  measureIsPct: boolean;
  /** true when larger values of the measure are worse */
  measureHigherIsBad: boolean;
  /** note from the LLM data-understanding agent when it reshaped/remapped */
  transformNote?: string;
  /** daily series (peak of the measure) for the top-risk elements — feeds per-element comparison charts */
  topEntityDaily: NamedSeries[];
}

/* ------------------------------- Pipeline ------------------------------- */

export type AgentStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface AgentDef {
  key: string;
  index: number;
  name: string;
  blurb: string;
}

export interface AgentProgressEvent {
  agentKey: string;
  status: AgentStatus;
  note?: string;
}

/* --------------------------- Dashboard actions --------------------------- */

export type DashboardAction =
  | { kind: "filter-regions"; regions: string[] }
  | { kind: "filter-dates"; lastDays?: number; clear?: boolean }
  | { kind: "filter-search"; search: string }
  | { kind: "filter-technology"; technology: string | null }
  | { kind: "reset-filters" }
  | { kind: "switch-persona"; persona: PersonaId }
  | { kind: "add-widget"; widget: WidgetSpec }
  | { kind: "remove-widget"; titleMatch: string }
  | { kind: "resize-widget"; titleMatch: string; span: 1 | 2 | 3 | 4 }
  | { kind: "set-limit"; titleMatch: string; limit: number }
  | { kind: "remove-kpi"; kpiMatch: string }
  | { kind: "add-kpi"; kpiMatch: string }
  | { kind: "reset-dashboard" };

/* --------------------------------- Chat --------------------------------- */

export interface ChatChart {
  kind: "bar" | "line";
  name: string;
  labels: string[];
  values: number[];
  unit?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  chart?: ChatChart;
  action?: "export-pdf" | "export-pptx" | "export-xlsx";
  at: number;
  /** true while tokens are still streaming from the local LLM */
  streaming?: boolean;
  /** which engine produced this reply: "rules" or a model name */
  engine?: string;
  /** human-readable list of dashboard changes that were applied */
  applied?: string[];
  /** dashboard changes that could not be applied */
  failed?: string[];
  /** smart offer: parsed-but-not-applied actions (answer mode) */
  suggestedActions?: DashboardAction[];
}

/* ------------------------------ Local LLM -------------------------------- */

export type LlmStatus = "off" | "connecting" | "connected" | "error";

export interface OllamaModelInfo {
  name: string;
  sizeGb: number;
  paramSize?: string;
  family?: string;
}

export interface LlmState {
  baseUrl: string;
  model: string | null;
  status: LlmStatus;
  models: OllamaModelInfo[];
  narrativeEnabled: boolean;
  error?: string;
  /** true while the storytelling agent is rewriting the narrative */
  enhancing: boolean;
}

/* --------------------------------- Misc --------------------------------- */

export type RoleId = "cto" | "noc" | "capacity" | "performance" | "assurance" | "admin";

export interface UserProfile {
  name: string;
  role: RoleId;
  loginAt: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  user: string;
  role: string;
  action: string;
  detail: string;
}

export interface FilterState {
  dateStart: number | null;
  dateEnd: number | null;
  regions: string[];
  technology: string | null;
  search: string;
}

export const EMPTY_FILTERS: FilterState = {
  dateStart: null,
  dateEnd: null,
  regions: [],
  technology: null,
  search: "",
};
