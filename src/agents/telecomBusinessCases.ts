import { uid, titleCase } from "@/lib/format";
import type {
  ColumnProfile,
  DataUnderstandingReport,
  Dataset,
  LlmDashboardPlan,
  SemanticMapping,
  TelecomBusinessCaseCandidate,
  TelecomBusinessCaseId,
  TelecomBusinessContext,
  WidgetSpec,
} from "@/lib/types";

const CASE_LABELS: Record<TelecomBusinessCaseId, string> = {
  critical_time_comparison: "Critical / Warning Time Comparison",
  congestion_risk: "Congestion Risk",
  capacity_upgrade: "Capacity Upgrade Prioritization",
  subscriber_impact: "Subscriber Impact",
  alarm_assurance: "Alarm / Fault Assurance",
  availability_degradation: "Availability / SLA Degradation",
  region_performance: "Region / Sector Performance",
  upgrade_followup: "Upgrade Status Follow-up",
  top_offenders: "Top Offenders / Chronic Issues",
  daily_exception: "Daily Operations Exceptions",
};

export const TELECOM_BUSINESS_CASE_OPTIONS: { id: TelecomBusinessCaseId; label: string }[] = (Object.keys(CASE_LABELS) as TelecomBusinessCaseId[]).map((id) => ({
  id,
  label: CASE_LABELS[id],
}));

export function detectTelecomBusinessContext(
  dataset: Dataset,
  profile: ColumnProfile[],
  mapping: SemanticMapping,
  prompt = ""
): TelecomBusinessContext {
  const columns = dataset.columns;
  const lower = `${columns.join(" ")} ${profile.flatMap((p) => p.samples).join(" ")} ${prompt}`.toLowerCase();
  const has = (re: RegExp) => re.test(lower);
  const measureNames = profile.filter((p) => p.role === "numeric").map((p) => p.name);
  const primaryMeasure = choosePrimaryMeasure(mapping, measureNames, prompt);
  const criticalMeasure = measureNames.find((c) => /critical.*time|time.*critical|حرج|critical/i.test(c));
  const warningMeasure = measureNames.find((c) => /warning.*time|time.*warning|warning|تحذير/i.test(c));
  const candidates: TelecomBusinessCaseCandidate[] = [];
  const add = (id: TelecomBusinessCaseId, score: number, reasons: string[]) => {
    if (score > 0) candidates.push({ id, label: CASE_LABELS[id], score: Math.min(99, Math.round(score)), reasons });
  };

  add("critical_time_comparison", score(
    [criticalMeasure ? 36 : 0, mapping.timestamp ? 18 : 0, mapping.entity ? 14 : 0, warningMeasure ? 8 : 0, has(/compare|three|3 days|critical time|warning time|مقارن/) ? 18 : 0],
    candidates
  ), compact([
    criticalMeasure && `critical-time measure detected (${criticalMeasure})`,
    warningMeasure && `warning-time measure detected (${warningMeasure})`,
    mapping.timestamp && `time comparison axis detected (${mapping.timestamp})`,
    has(/compare|three|3 days|critical time|warning time|مقارن/) && "user prompt asks for comparison",
  ]));
  add("congestion_risk", score([mapping.utilization ? 40 : 0, mapping.capacity ? 12 : 0, has(/congest|utilization|capacity pressure|اختناق/) ? 24 : 0], candidates), compact([
    mapping.utilization && `utilization measure detected (${mapping.utilization})`,
    mapping.capacity && `capacity column detected (${mapping.capacity})`,
  ]));
  add("capacity_upgrade", score([mapping.capacity ? 26 : 0, /upgrade|plan|rollout|capacity/.test(lower) ? 30 : 0, mapping.utilization ? 12 : 0], candidates), compact([
    mapping.capacity && "capacity signal detected",
    /upgrade|plan|rollout/.test(lower) && "upgrade/planning values detected",
  ]));
  add("subscriber_impact", score([mapping.subscribers ? 34 : 0, has(/subscriber|customer|impact|مشترك/) ? 22 : 0, mapping.entity ? 8 : 0], candidates), compact([
    mapping.subscribers && `subscriber column detected (${mapping.subscribers})`,
  ]));
  add("alarm_assurance", score([mapping.alarms ? 34 : 0, mapping.criticalAlarms ? 18 : 0, has(/alarm|fault|incident|انذار|عطل/) ? 20 : 0], candidates), compact([
    mapping.alarms && `alarm column detected (${mapping.alarms})`,
    mapping.criticalAlarms && `critical alarm column detected (${mapping.criticalAlarms})`,
  ]));
  add("availability_degradation", score([mapping.availability ? 36 : 0, has(/availability|sla|degrad|outage|اتاحة/) ? 24 : 0], candidates), compact([
    mapping.availability && `availability column detected (${mapping.availability})`,
  ]));
  add("upgrade_followup", score([/upgrade_status|upgrade|rollout|solved|cancelled|not_in/i.test(lower) ? 40 : 0, mapping.entity ? 10 : 0, mapping.region ? 8 : 0], candidates), compact([
    /upgrade_status|upgrade|rollout/i.test(lower) && "upgrade/status fields detected",
  ]));
  add("region_performance", score([mapping.region ? 24 : 0, primaryMeasure ? 18 : 0, has(/region|sector|governorate|منطقة|قطاع/) ? 16 : 0], candidates), compact([
    mapping.region && `region/grouping column detected (${mapping.region})`,
  ]));
  add("top_offenders", score([mapping.entity ? 20 : 0, primaryMeasure ? 20 : 0, mapping.measureHigherIsBad ? 14 : 0, has(/top|worst|offender|chronic|اسوأ/) ? 22 : 0], candidates), compact([
    mapping.entity && `entity column detected (${mapping.entity})`,
    mapping.measureHigherIsBad && "higher values appear worse",
  ]));
  add("daily_exception", score([primaryMeasure ? 14 : 0, has(/exception|daily|today|yesterday|status|حالة/) ? 18 : 0], candidates), compact([
    "daily operations report pattern detected",
  ]));

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) {
    candidates.push({ id: "daily_exception", label: CASE_LABELS.daily_exception, score: 35, reasons: ["generic telecom operations report"] });
  }
  const selected = candidates[0];

  return {
    selectedCaseId: selected.id,
    selectedLabel: selected.label,
    candidates: candidates.slice(0, 5),
    entityColumn: mapping.entity,
    regionColumn: mapping.region,
    sectorColumn: findColumn(columns, /sector|قطاع/i),
    statusColumn: findColumn(columns, /status|state|upgrade|حالة/i),
    subscriberColumn: mapping.subscribers,
    primaryMeasure,
    comparisonMeasure: criticalMeasure ?? primaryMeasure,
    warningMeasure,
    hasTimeComparison: !!mapping.timestamp && !!(criticalMeasure ?? primaryMeasure),
  };
}

export function getTelecomBusinessCaseLabel(id: TelecomBusinessCaseId): string {
  return CASE_LABELS[id];
}

export function buildTelecomPlaybookPlan(
  report: DataUnderstandingReport,
  selectedCaseId: TelecomBusinessCaseId,
  prompt: string,
  engine = "playbook"
): LlmDashboardPlan {
  const ctx = { ...report.businessContext, selectedCaseId, selectedLabel: CASE_LABELS[selectedCaseId] };
  const widgets = widgetsForCase(ctx);
  return {
    prompt,
    engine,
    businessCaseId: selectedCaseId,
    persona: personaForCase(selectedCaseId),
    title: CASE_LABELS[selectedCaseId],
    description: descriptionForCase(selectedCaseId),
    widgets,
    reasoning: widgets.map((w) => ({
      persona: personaForCase(selectedCaseId),
      widgetTitle: w.title,
      reason: reasonForWidget(selectedCaseId, w.type),
      sourceColumns: compact([ctx.primaryMeasure, ctx.comparisonMeasure, ctx.warningMeasure, ctx.entityColumn, ctx.regionColumn, ctx.subscriberColumn]).slice(0, 6),
    })),
    warnings: [],
    rawIntent: `Selected telecom business case: ${CASE_LABELS[selectedCaseId]}.`,
  };
}

function widgetsForCase(ctx: TelecomBusinessContext): WidgetSpec[] {
  const id = ctx.selectedCaseId;
  const businessKey = id;
  const base: WidgetSpec[] = [
    w("kpi-grid", "Key Performance Indicators", 4, { dataKey: `business:${id}`, playbookKey: "kpis" }),
    w("dashboard-reasoning", "Why This Dashboard", 4, { dataKey: personaForCase(id), playbookKey: "reasoning" }),
  ];
  if (id === "critical_time_comparison") {
    return [
      ...base,
      w("business-comparison-bars", "Critical Time Comparison", 4, { dataKey: businessKey, tall: true, playbookKey: "comparison" }),
      w("business-delta-table", "Worst MSAN Delta", 4, { dataKey: businessKey, tall: true, playbookKey: "delta-table" }),
      ...(ctx.regionColumn ? [w("trend", "Critical Time by Region", 4, { dataKey: "regions", playbookKey: "region-trend" })] : []),
      w("insights", "Operational Findings", 4, { tall: true, playbookKey: "insights" }),
    ];
  }
  if (id === "upgrade_followup") {
    return [
      ...base,
      w("business-status-breakdown", "Upgrade Status Breakdown", 2, { dataKey: businessKey, playbookKey: "status-breakdown" }),
      w("business-delta-table", "Priority Follow-up Items", 4, { dataKey: businessKey, tall: true, playbookKey: "delta-table" }),
      w("insights", "Rollout Follow-up", 2, { tall: true, playbookKey: "insights" }),
    ];
  }
  if (id === "subscriber_impact") {
    return [
      ...base,
      w("pareto", "Subscribers by Segment", 2, { dataKey: "subscribers", playbookKey: "subscriber-pareto" }),
      w("table-entities", "Highest Subscriber Impact", 4, { dataKey: "breakdown", tall: true, playbookKey: "impact-table" }),
      w("insights", "Impact Summary", 2, { tall: true, playbookKey: "insights" }),
    ];
  }
  if (id === "congestion_risk" || id === "capacity_upgrade") {
    return [
      ...base,
      w("scatter", id === "capacity_upgrade" ? "Expansion Priority Quadrant" : "Risk Quadrant", 2, { playbookKey: "risk-quadrant" }),
      w("table-entities", "Priority Elements", 2, { dataKey: id === "capacity_upgrade" ? "saturation" : "risk", tall: true, playbookKey: "priority-table" }),
      w("trend", "Risk Trend", 4, { dataKey: "regions", playbookKey: "risk-trend" }),
      w("insights", "Recommended Actions", 4, { tall: true, playbookKey: "insights" }),
    ];
  }
  if (id === "alarm_assurance" || id === "availability_degradation") {
    return [
      ...base,
      w("area-trend", id === "alarm_assurance" ? "Alarm Trend" : "Service Degradation Trend", 2, { dataKey: "alarms", playbookKey: "alarm-trend" }),
      w("anomalies", "Incident Signatures", 2, { tall: true, playbookKey: "anomalies" }),
      w("table-regions", "Regional Impact", 4, { playbookKey: "regional-impact" }),
      w("insights", "Assurance Findings", 4, { playbookKey: "insights" }),
    ];
  }
  return [
    ...base,
    w("trend", "Primary Measure Trend", 4, { dataKey: "regions", playbookKey: "trend" }),
    w("table-entities", id === "top_offenders" ? "Top Offenders" : "Operational Exceptions", 4, { dataKey: "risk", tall: true, playbookKey: "table" }),
    w("insights", "Operational Findings", 4, { tall: true, playbookKey: "insights" }),
  ];
}

function personaForCase(id: TelecomBusinessCaseId) {
  if (id === "congestion_risk" || id === "alarm_assurance" || id === "critical_time_comparison" || id === "daily_exception") return "noc";
  if (id === "capacity_upgrade" || id === "upgrade_followup") return "capacity";
  if (id === "availability_degradation" || id === "subscriber_impact") return "assurance";
  if (id === "region_performance") return "performance";
  return "overview";
}

function descriptionForCase(id: TelecomBusinessCaseId): string {
  switch (id) {
    case "critical_time_comparison":
      return "Compares critical/warning time across detected daily periods and ranks worsening MSANs.";
    case "capacity_upgrade":
      return "Prioritizes capacity actions from risk, growth, and saturation signals.";
    case "alarm_assurance":
      return "Surfaces alarm/fault pressure and assurance incident signatures.";
    default:
      return `${CASE_LABELS[id]} dashboard generated from detected telecom business context.`;
  }
}

function reasonForWidget(id: TelecomBusinessCaseId, type: WidgetSpec["type"]): string {
  if (type === "business-comparison-bars") return "Shows the same operational measure across daily periods so users can compare movement by element.";
  if (type === "business-delta-table") return "Ranks offenders by latest value and delta so daily operations can act on worsening items.";
  if (type === "business-status-breakdown") return "Summarizes status/category distribution for rollout or exception follow-up.";
  if (type === "dashboard-reasoning") return `Explains why the ${CASE_LABELS[id]} playbook was selected.`;
  return `Selected by the ${CASE_LABELS[id]} playbook for this telecom report.`;
}

function choosePrimaryMeasure(mapping: SemanticMapping, measureNames: string[], prompt: string): string | undefined {
  const q = prompt.toLowerCase();
  if (/warning/.test(q)) return measureNames.find((c) => /warning/i.test(c)) ?? mapping.primaryMeasure;
  if (/critical|حرج/.test(q)) return measureNames.find((c) => /critical/i.test(c)) ?? mapping.primaryMeasure;
  return mapping.primaryMeasure ?? measureNames.find((c) => /critical/i.test(c)) ?? measureNames[0];
}

function findColumn(cols: string[], re: RegExp): string | undefined {
  return cols.find((c) => re.test(c));
}

function score(parts: number[], _existing: TelecomBusinessCaseCandidate[]): number {
  return parts.reduce((s, x) => s + x, 0);
}

function compact<T>(items: (T | undefined | null | false)[]): T[] {
  return items.filter((x): x is T => !!x);
}

function w(type: WidgetSpec["type"], title: string, span: 1 | 2 | 3 | 4, extra?: Partial<WidgetSpec>): WidgetSpec {
  return { id: uid("w"), type, title: titleCase(title), span, ...extra };
}
