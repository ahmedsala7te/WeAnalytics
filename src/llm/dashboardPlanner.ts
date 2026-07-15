import { buildUnderstandingDigest } from "@/agents/dataUnderstanding";
import { buildTelecomPlaybookPlan } from "@/agents/telecomBusinessCases";
import { uid } from "@/lib/format";
import { chatOnce } from "./ollamaClient";
import type {
  DataUnderstandingReport,
  DashboardPlanWarning,
  DashboardReason,
  LlmDashboardPlan,
  PersonaId,
  WidgetSpec,
  WidgetType,
} from "@/lib/types";

const ALLOWED_TYPES: WidgetType[] = [
  "kpi-grid",
  "gauge",
  "tilemap",
  "geo-map-3d",
  "trend",
  "area-trend",
  "heatmap",
  "busy-hour",
  "pareto",
  "treemap",
  "sankey",
  "scatter",
  "forecast",
  "histogram",
  "table-entities",
  "table-regions",
  "anomalies",
  "insights",
  "dashboard-reasoning",
  "business-comparison-bars",
  "business-delta-table",
  "business-status-breakdown",
  "correlation",
  "entity-bars",
];

const PERSONAS: PersonaId[] = ["executive", "noc", "capacity", "performance", "assurance", "overview"];

const SYSTEM = `You are the dashboard planning agent for NetPulse. You receive a data-understanding digest for one uploaded table and an optional user instruction.

Return STRICT JSON only, no markdown:
{
  "persona": "executive|noc|capacity|performance|assurance|overview",
  "title": "short dashboard title",
  "description": "one sentence",
  "intent": "one sentence explaining what the dashboard is optimized for",
  "preferredOrder": ["playbook widget keys in preferred order"],
  "widgetPatches": [
    {
      "playbookKey": "exact key from the base playbook",
      "title": "optional better widget title",
      "span": 1|2|3|4,
      "tall": true|false,
      "reason": "why this widget belongs on this dashboard",
      "sourceColumns": ["exact column names from the digest"]
    }
  ],
  "extraWidgets": []
}

Rules:
- Do NOT invent numbers, KPIs, columns, rows, regions, or entities.
- Use only column names that appear in the digest.
- The provided telecom playbook is the dashboard. You are refining it, not replacing it.
- Prefer using preferredOrder and widgetPatches. extraWidgets should usually be empty.
- Use trend/forecast only if a timestamp and numeric measure exist.
- Use heatmap/busy-hour only for timestamp + utilization-like data.
- Use table/pareto when there is a segment/entity/group column.
- Widget types: ${ALLOWED_TYPES.join(", ")}.
- dataKey hints: kpi-grid = generic|executive|noc|capacity|performance|assurance|business:<case>; pareto = measure|congestion|subscribers; table-entities = risk|saturation|congestion|breakdown; trend = regions|overall; forecast = 0.`;

interface RawWidget {
  type?: unknown;
  title?: unknown;
  span?: unknown;
  dataKey?: unknown;
  tall?: unknown;
  reason?: unknown;
  sourceColumns?: unknown;
}

interface RawWidgetPatch {
  playbookKey?: unknown;
  title?: unknown;
  span?: unknown;
  tall?: unknown;
  reason?: unknown;
  sourceColumns?: unknown;
}

interface RawPlan {
  persona?: unknown;
  title?: unknown;
  description?: unknown;
  intent?: unknown;
  preferredOrder?: unknown;
  widgetPatches?: unknown;
  extraWidgets?: unknown;
  widgets?: unknown;
}

export async function planDashboardWithOllama(
  report: DataUnderstandingReport,
  prompt: string,
  llm: { baseUrl: string; model: string }
): Promise<LlmDashboardPlan> {
  const playbook = buildTelecomPlaybookPlan(report, report.businessContext.selectedCaseId, prompt);
  const raw = await chatOnce({
    baseUrl: llm.baseUrl,
    model: llm.model,
    json: true,
    temperature: 0.15,
    maxTokens: 1200,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `DATA UNDERSTANDING DIGEST:\n${buildUnderstandingDigest(report)}\n\nSELECTED TELECOM BUSINESS CASE:\n${report.businessContext.selectedLabel} (${report.businessContext.selectedCaseId})\n\nBASE PLAYBOOK TO REFINE:\n${JSON.stringify(playbook.widgets.map((w) => ({ playbookKey: w.playbookKey, type: w.type, title: w.title, span: w.span, dataKey: w.dataKey, tall: w.tall })), null, 2)}\n\nUSER DASHBOARD INSTRUCTION:\n${prompt.trim() || "(none; choose the most useful dashboard for this data)"}\n\nReturn the JSON refinement patch.`,
      },
    ],
  });
  const parsed = parsePlan(raw);
  if (!parsed) throw new Error("Ollama did not return a valid dashboard plan JSON object.");
  return validateDashboardPlan(parsed, report, prompt, llm.model);
}

export function validateDashboardPlan(
  raw: RawPlan,
  report: DataUnderstandingReport,
  prompt: string,
  engine = "rules"
): LlmDashboardPlan {
  const warnings: DashboardPlanWarning[] = [];
  const colSet = new Set(report.dataset.columns);
  const canUse = availability(report);
  const playbook = buildTelecomPlaybookPlan(report, report.businessContext.selectedCaseId, prompt, "playbook");
  const persona = PERSONAS.includes(raw.persona as PersonaId) ? (raw.persona as PersonaId) : playbook.persona;
  const widgets: WidgetSpec[] = playbook.widgets.map((w) => ({ ...w }));
  const reasoning: DashboardReason[] = playbook.reasoning.map((r) => ({ ...r, persona }));

  const pushWidget = (rw: RawWidget, fallbackTitle?: string) => {
    const lowerType = typeof rw.type === "string" ? rw.type.toLowerCase().trim() : "";
    const type = lowerType && ALLOWED_TYPES.includes(lowerType as WidgetType) ? (lowerType as WidgetType) : null;
    if (!type) {
      warnings.push({ severity: "warning", message: `Dropped an unsupported widget type: ${String(rw.type ?? "unknown")}.` });
      return;
    }
    const available = canUse(type);
    if (!available.ok) {
      warnings.push({ severity: "info", message: `Skipped "${typeof rw.title === "string" ? rw.title : type}" because ${available.reason}.` });
      return;
    }
    const span = rw.span === 1 || rw.span === 2 || rw.span === 3 || rw.span === 4 ? rw.span : type === "kpi-grid" || type === "dashboard-reasoning" ? 4 : 2;
    const title = cleanTitle(typeof rw.title === "string" ? rw.title : fallbackTitle ?? type);
    const sourceColumns = Array.isArray(rw.sourceColumns)
      ? rw.sourceColumns.filter((c): c is string => typeof c === "string" && colSet.has(c)).slice(0, 6)
      : [];
    const widget: WidgetSpec = {
      id: uid("w"),
      type,
      title,
      span,
      ...(typeof rw.dataKey === "string" ? { dataKey: sanitizeDataKey(type, rw.dataKey) } : {}),
      ...(rw.tall === true ? { tall: true } : {}),
    };
    widgets.push(widget);
    reasoning.push({
      persona,
      widgetTitle: title,
      reason: typeof rw.reason === "string" && rw.reason.trim() ? rw.reason.slice(0, 260) : `Chosen by the local LLM for the requested dashboard focus.`,
      sourceColumns,
    });
  };

  const patchReason = (oldTitle: string, newTitle: string, patch: RawWidgetPatch) => {
    const sourceColumns = Array.isArray(patch.sourceColumns)
      ? patch.sourceColumns.filter((c): c is string => typeof c === "string" && colSet.has(c)).slice(0, 6)
      : undefined;
    const reason = typeof patch.reason === "string" && patch.reason.trim() ? patch.reason.slice(0, 260) : undefined;
    const existing = reasoning.find((r) => r.widgetTitle === oldTitle);
    if (existing) {
      existing.widgetTitle = newTitle;
      if (reason) existing.reason = reason;
      if (sourceColumns) existing.sourceColumns = sourceColumns;
    } else if (reason || sourceColumns) {
      reasoning.push({ persona, widgetTitle: newTitle, reason: reason ?? "Refined from the selected telecom playbook.", sourceColumns: sourceColumns ?? [] });
    }
  };

  const patches = Array.isArray(raw.widgetPatches) ? raw.widgetPatches : [];
  for (const item of patches) {
    if (!item || typeof item !== "object") continue;
    const patch = item as RawWidgetPatch;
    if (typeof patch.playbookKey !== "string") continue;
    const widget = widgets.find((w) => w.playbookKey === patch.playbookKey);
    if (!widget) {
      warnings.push({ severity: "info", message: `Ollama suggested a refinement for unknown playbook widget "${patch.playbookKey}", so it was ignored.` });
      continue;
    }
    const oldTitle = widget.title;
    if (typeof patch.title === "string" && patch.title.trim()) widget.title = cleanTitle(patch.title);
    if (patch.span === 1 || patch.span === 2 || patch.span === 3 || patch.span === 4) widget.span = patch.span;
    if (typeof patch.tall === "boolean") widget.tall = patch.tall;
    patchReason(oldTitle, widget.title, patch);
  }

  const preferredOrder = Array.isArray(raw.preferredOrder) ? raw.preferredOrder.filter((k): k is string => typeof k === "string") : [];
  if (preferredOrder.length > 0) {
    const order = new Map(preferredOrder.map((k, i) => [k, i]));
    widgets.sort((a, b) => (order.get(a.playbookKey ?? "") ?? 999) - (order.get(b.playbookKey ?? "") ?? 999));
  }

  const extras = Array.isArray(raw.extraWidgets) ? raw.extraWidgets : Array.isArray(raw.widgets) ? raw.widgets : [];
  for (const item of extras) {
    if (item && typeof item === "object") pushWidget(item as RawWidget);
    if (widgets.length >= 10) break;
  }

  return {
    prompt,
    engine,
    businessCaseId: report.businessContext.selectedCaseId,
    persona,
    title: cleanTitle(typeof raw.title === "string" ? raw.title : playbook.title),
    description: typeof raw.description === "string" && raw.description.trim() ? raw.description.slice(0, 180) : playbook.description,
    widgets: widgets.slice(0, 10),
    reasoning,
    warnings,
    rawIntent: typeof raw.intent === "string" ? raw.intent.slice(0, 240) : playbook.rawIntent,
  };
}

function parsePlan(raw: string): RawPlan | null {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw.trim());
  if (!parsed) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) parsed = tryParse(raw.slice(start, end + 1));
  }
  return parsed && typeof parsed === "object" ? (parsed as RawPlan) : null;
}

function availability(report: DataUnderstandingReport): (type: WidgetType) => { ok: boolean; reason: string } {
  const m = report.mapping;
  const hasEntity = !!m.entity || !!m.region;
  const hasTime = !!m.timestamp;
  const hasMeasure = !!m.primaryMeasure || report.quality.numericColumns > 0;
  return (type) => {
    switch (type) {
      case "trend":
      case "forecast":
      case "anomalies":
        return { ok: hasTime && hasMeasure, reason: "it needs a timestamp and numeric measure" };
      case "area-trend":
        return { ok: hasTime && !!m.alarms, reason: "it needs timestamp and alarm columns" };
      case "heatmap":
      case "busy-hour":
        return { ok: hasTime && !!m.utilization, reason: "it needs timestamp plus utilization data" };
      case "pareto":
      case "table-entities":
      case "scatter":
      case "entity-bars":
        return { ok: hasEntity && hasMeasure, reason: "it needs a breakdown dimension and numeric measure" };
      case "business-comparison-bars":
      case "business-delta-table":
        return { ok: report.businessContext.hasTimeComparison || (!!m.timestamp && hasMeasure), reason: "it needs a time comparison measure" };
      case "business-status-breakdown":
        return { ok: !!report.businessContext.statusColumn || hasEntity, reason: "it needs a status or breakdown column" };
      case "table-regions":
      case "tilemap":
      case "treemap":
        return { ok: !!m.region, reason: "it needs a region/grouping column" };
      case "geo-map-3d":
        return { ok: !!m.latitude && !!m.longitude, reason: "it needs latitude and longitude columns" };
      case "histogram":
        return { ok: hasMeasure, reason: "it needs a numeric measure" };
      case "gauge":
        return { ok: !!m.utilization, reason: "it needs utilization data" };
      case "sankey":
        return { ok: !!m.traffic && !!m.utilization, reason: "it needs traffic and utilization data" };
      case "correlation":
        return { ok: report.quality.numericColumns >= 2, reason: "it needs at least two numeric measures" };
      default:
        return { ok: true, reason: "" };
    }
  };
}

function fallbackWidgets(report: DataUnderstandingReport, persona: PersonaId): RawWidget[] {
  const m = report.mapping;
  return [
    { type: "kpi-grid", title: "Key Performance Indicators", span: 4, dataKey: persona === "overview" ? "generic" : persona, reason: "Fallback KPI summary from deterministic analytics.", sourceColumns: [m.primaryMeasure].filter(Boolean) },
    ...(m.timestamp && m.primaryMeasure ? [{ type: "trend", title: "Primary Measure Trend", span: 4, dataKey: "regions", reason: "Fallback trend from detected timestamp and measure.", sourceColumns: [m.timestamp, m.primaryMeasure].filter(Boolean) }] : []),
    ...(m.entity || m.region ? [{ type: "table-entities", title: "Top Segments", span: 4, dataKey: "breakdown", reason: "Fallback table from detected breakdown dimension.", sourceColumns: [m.entity, m.region, m.primaryMeasure].filter(Boolean) }] : []),
    { type: "insights", title: "AI Insights", span: 4, tall: true, reason: "Fallback narrative and recommendations from deterministic analysis.", sourceColumns: [m.primaryMeasure].filter(Boolean) },
  ];
}

function sanitizeDataKey(type: WidgetType, key: string): string {
  const allowed: Partial<Record<WidgetType, string[]>> = {
    "kpi-grid": ["generic", "executive", "noc", "capacity", "performance", "assurance", "business:critical_time_comparison", "business:congestion_risk", "business:capacity_upgrade", "business:subscriber_impact", "business:alarm_assurance", "business:availability_degradation", "business:region_performance", "business:upgrade_followup", "business:top_offenders", "business:daily_exception"],
    pareto: ["measure", "congestion", "subscribers"],
    "table-entities": ["risk", "saturation", "congestion", "breakdown"],
    trend: ["regions", "overall"],
    forecast: ["0"],
    "area-trend": ["alarms"],
    "business-comparison-bars": ["critical_time_comparison", "daily_exception", "top_offenders"],
    "business-delta-table": ["critical_time_comparison", "daily_exception", "top_offenders", "upgrade_followup"],
    "business-status-breakdown": ["upgrade_followup", "daily_exception"],
  };
  const opts = allowed[type];
  return opts?.includes(key) ? key : key.slice(0, 24);
}

function cleanTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 64) || "Dashboard Widget";
}
