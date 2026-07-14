import { chatOnce } from "./ollamaClient";
import { uid } from "@/lib/format";
import type { AnalysisResult, DashboardAction, PersonaId, WidgetSpec, WidgetType } from "@/lib/types";

/* ------------------------------------------------------------------------
 * LLM fallback for dashboard actions: when the deterministic parser finds
 * nothing, the local model translates free-form requests into the action
 * schema. Every action is validated against the live analysis before use —
 * invalid actions are silently dropped.
 * ---------------------------------------------------------------------- */

const ALLOWED_TYPES: WidgetType[] = [
  "kpi-grid", "gauge", "tilemap", "trend", "area-trend", "heatmap", "busy-hour",
  "pareto", "treemap", "sankey", "scatter", "forecast", "histogram",
  "table-entities", "table-regions", "anomalies", "insights", "dashboard-reasoning",
  "business-comparison-bars", "business-delta-table", "business-status-breakdown", "entity-bars",
];

const SYSTEM = `You translate a user's request about their telecom analytics dashboard into a STRICT JSON array of actions. No prose, no markdown — only the JSON array. If the request is not about changing the dashboard, or is too vague to act on confidently, return [].

Allowed actions:
{"kind":"filter-regions","regions":["<exact region name>", ...]}        // [] = show all regions
{"kind":"filter-dates","lastDays":7}  or  {"kind":"filter-dates","clear":true}
{"kind":"filter-search","search":"<element name fragment>"}
{"kind":"reset-filters"}
{"kind":"switch-persona","persona":"executive|noc|capacity|performance|assurance|overview"}
{"kind":"add-widget","type":"<widget type>","title":"<short title>","span":1|2|3|4,"dataKey":"<optional>","limit":<optional 3-50>}
{"kind":"remove-widget","titleMatch":"<existing widget title fragment>"}
{"kind":"resize-widget","titleMatch":"<existing widget title fragment>","span":1|2|3|4}
{"kind":"set-limit","titleMatch":"<existing widget title fragment>","limit":<3-50>}
{"kind":"remove-kpi","kpiMatch":"<KPI name from the catalog>"}   // hides one KPI card inside the KPI grid
{"kind":"add-kpi","kpiMatch":"<KPI name from the catalog>"}      // shows a KPI card
{"kind":"reset-dashboard"}

Widget types: ${ALLOWED_TYPES.join(", ")}. dataKey options — pareto: "congestion"|"measure"; table-entities: "risk"|"saturation"|"congestion"; trend: "regions"|"overall"; forecast: "0".
"business-comparison-bars" = telecom playbook comparison chart across short daily periods.
"business-delta-table" = telecom latest vs previous offender table.
"business-status-breakdown" = telecom status/category breakdown for upgrade or exception reports.
"entity-bars" = per-element comparison chart: one group of bars per element (MSAN/site/link), one bar per day — use it for requests like "bars per MSAN", "compare elements across days".
KPI cards (inside the KPI grid) are NOT widgets — to hide/show a single KPI card use remove-kpi/add-kpi with a name from the KPI catalog.
Use ONLY region names, personas, widget titles and KPI names from the catalog the user provides. Region names must be copied EXACTLY (they may be Arabic).`;

interface RawAction {
  kind?: string;
  regions?: unknown;
  lastDays?: unknown;
  clear?: unknown;
  search?: unknown;
  persona?: unknown;
  type?: unknown;
  title?: unknown;
  span?: unknown;
  dataKey?: unknown;
  limit?: unknown;
  titleMatch?: unknown;
  kpiMatch?: unknown;
  technology?: unknown;
}

export async function planActions(
  q: string,
  analysis: AnalysisResult,
  currentWidgets: WidgetSpec[],
  llm: { baseUrl: string; model: string },
  recentContext?: string
): Promise<DashboardAction[]> {
  const catalog = [
    `REGIONS (ordered worst health → best): ${analysis.regionStats.map((r) => r.region).join(" | ") || "(none)"}`,
    `PERSONAS: ${analysis.dashboards.map((d) => d.persona).join(", ")}`,
    `CURRENT WIDGETS: ${currentWidgets.map((w) => `"${w.title}" [${w.type}]`).join(", ")}`,
    `KPI CARDS (in the KPI grid): ${analysis.kpis.map((k) => k.name).join(" | ")}`,
    `PRIMARY MEASURE: ${analysis.measureLabel}`,
    analysis.timeRange ? `TIME WINDOW: ${analysis.timeRange.days} days` : "TIME WINDOW: none (snapshot)",
  ].join("\n");

  let raw: string;
  try {
    raw = await chatOnce({
      baseUrl: llm.baseUrl,
      model: llm.model,
      json: true,
      temperature: 0.1,
      maxTokens: 500,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `CATALOG:\n${catalog}\n${recentContext ? `\nCONVERSATION CONTEXT (for follow-ups like "for msan please"):\n${recentContext}\n` : ""}\nREQUEST: ${q}\n\nReturn the JSON array of actions.`,
        },
      ],
    });
  } catch (err) {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lastActionPlan = { error: String(err) };
    return [];
  }
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lastActionPlan = { raw };

  // format:"json" may emit a bare array or wrap it in an object — try both
  let parsed: unknown = null;
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  parsed = tryParse(raw.trim());
  if (parsed === null) {
    const s = raw.indexOf("[");
    const e = raw.lastIndexOf("]");
    if (s >= 0 && e > s) parsed = tryParse(raw.slice(s, e + 1));
  }
  if (parsed === null) {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) parsed = tryParse(raw.slice(s, e + 1));
  }
  if (parsed === null) return [];
  let arr: RawAction[] = [];
  const isAction = (x: unknown): boolean => !!x && typeof x === "object" && typeof (x as RawAction).kind === "string";
  if (Array.isArray(parsed)) arr = parsed as RawAction[];
  else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (isAction(obj)) {
      // bare single action: {"kind": "...", ...}
      arr = [obj as RawAction];
    } else {
      // wrapped list: {"actions": [{kind...}, ...]} — the array must contain actions
      const actionArray = Object.values(obj).find((v) => Array.isArray(v) && v.length > 0 && v.every(isAction));
      if (Array.isArray(actionArray)) arr = actionArray as RawAction[];
    }
  }

  /* ------------------------------ validation ------------------------------ */
  const regions = new Set(analysis.regionStats.map((r) => r.region));
  const personas = new Set(analysis.dashboards.map((d) => d.persona));
  const out: DashboardAction[] = [];
  for (const a of arr.slice(0, 6)) {
    if (!a || typeof a.kind !== "string") continue;
    switch (a.kind) {
      case "filter-regions": {
        if (!Array.isArray(a.regions)) break;
        const valid = (a.regions as unknown[]).filter((r): r is string => typeof r === "string" && regions.has(r));
        if (valid.length > 0 || (a.regions as unknown[]).length === 0) out.push({ kind: "filter-regions", regions: valid });
        break;
      }
      case "filter-dates": {
        if (a.clear === true) out.push({ kind: "filter-dates", clear: true });
        else if (typeof a.lastDays === "number" && a.lastDays >= 1 && a.lastDays <= 365) out.push({ kind: "filter-dates", lastDays: Math.round(a.lastDays) });
        break;
      }
      case "filter-search":
        if (typeof a.search === "string" && a.search.trim().length >= 2) out.push({ kind: "filter-search", search: a.search.trim().slice(0, 60) });
        break;
      case "reset-filters":
        out.push({ kind: "reset-filters" });
        break;
      case "switch-persona":
        if (typeof a.persona === "string" && personas.has(a.persona as PersonaId)) out.push({ kind: "switch-persona", persona: a.persona as PersonaId });
        break;
      case "add-widget": {
        if (typeof a.type !== "string" || !ALLOWED_TYPES.includes(a.type as WidgetType)) break;
        const span = typeof a.span === "number" && a.span >= 1 && a.span <= 4 ? (Math.round(a.span) as 1 | 2 | 3 | 4) : 2;
        const limit = typeof a.limit === "number" ? Math.max(3, Math.min(50, Math.round(a.limit))) : undefined;
        out.push({
          kind: "add-widget",
          widget: {
            id: uid("w"),
            type: a.type as WidgetType,
            title: typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 60) : `New ${a.type}`,
            span,
            dataKey: typeof a.dataKey === "string" ? a.dataKey : undefined,
            limit,
            tall: ["heatmap", "anomalies", "table-entities", "insights", "treemap", "sankey"].includes(a.type),
          },
        });
        break;
      }
      case "remove-widget":
        if (typeof a.titleMatch === "string" && a.titleMatch.trim().length >= 3) out.push({ kind: "remove-widget", titleMatch: a.titleMatch.trim() });
        break;
      case "resize-widget":
        if (typeof a.titleMatch === "string" && typeof a.span === "number" && a.span >= 1 && a.span <= 4)
          out.push({ kind: "resize-widget", titleMatch: a.titleMatch.trim(), span: Math.round(a.span) as 1 | 2 | 3 | 4 });
        break;
      case "set-limit":
        if (typeof a.titleMatch === "string" && typeof a.limit === "number")
          out.push({ kind: "set-limit", titleMatch: a.titleMatch.trim(), limit: Math.max(3, Math.min(50, Math.round(a.limit))) });
        break;
      case "remove-kpi":
        if (typeof a.kpiMatch === "string" && a.kpiMatch.trim().length >= 3) out.push({ kind: "remove-kpi", kpiMatch: a.kpiMatch.trim() });
        break;
      case "add-kpi":
        if (typeof a.kpiMatch === "string" && a.kpiMatch.trim().length >= 3) out.push({ kind: "add-kpi", kpiMatch: a.kpiMatch.trim() });
        break;
      case "reset-dashboard":
        out.push({ kind: "reset-dashboard" });
        break;
      default:
        break;
    }
  }

  /* safety guard: destructive actions need explicit intent words in the
   * user's request — a vague follow-up must never reset or remove things */
  const ql = q.toLowerCase();
  return out.filter((a) => {
    if (a.kind === "reset-dashboard" || a.kind === "reset-filters") return /(reset|default|undo|original|استرجع|رجع)/.test(ql);
    if (a.kind === "remove-widget" || a.kind === "remove-kpi") return /(remove|delete|hide|drop|without|بدون|احذف|شيل|اخفي)/.test(ql);
    return true;
  });
}
