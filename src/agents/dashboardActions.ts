import { uid } from "@/lib/format";
import { PERSONAS } from "@/lib/constants";
import type { AnalysisResult, DashboardAction, Kpi, PersonaId, WidgetSpec, WidgetType } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Chat-driven dashboard actions — deterministic NL parser.
 * Translates requests like "show only Alexandria", "add a top 20 congested
 * table", "remove the heatmap" into validated DashboardAction objects.
 * ---------------------------------------------------------------------- */

/* ------------------------------ widget intents --------------------------- */

interface WidgetIntent {
  type: WidgetType;
  match: RegExp;
  title: (a: AnalysisResult) => string;
  span: 1 | 2 | 3 | 4;
  tall?: boolean;
  dataKey?: (q: string) => string | undefined;
}

const WIDGET_INTENTS: WidgetIntent[] = [
  {
    // "bars for every msan", "per element comparison", "trend by msan"
    type: "entity-bars",
    match: /(per|by|every|each|لكل)[\s-]*(msan|element|site|link|node|cell|entity|كبينة|عنصر)|element comparison|msan comparison/,
    title: (a) => `${a.measureLabel} by Element — Daily Comparison`,
    span: 4,
    dataKey: () => undefined,
  },
  { type: "heatmap", match: /heat\s?map/, title: () => "Congestion Heatmap — Region × Hour", span: 4, tall: true },
  { type: "busy-hour", match: /busy\s?hour|hourly profile|24.?hour/, title: () => "24-Hour Load Profile", span: 2 },
  { type: "forecast", match: /forecast|projection|saturation chart/, title: () => "Capacity Forecast", span: 2, dataKey: () => "0" },
  { type: "scatter", match: /scatter|quadrant|bubble/, title: () => "Expansion Priority Quadrant", span: 2 },
  { type: "histogram", match: /histogram|distribution/, title: (a) => `${a.measureLabel} Distribution`, span: 2 },
  { type: "anomalies", match: /anomal|incident list|storm list/, title: () => "Anomalies & Alarm Storms", span: 2, tall: true },
  { type: "treemap", match: /tree\s?map/, title: () => "Capacity Risk by Region", span: 2, tall: true },
  { type: "sankey", match: /sankey|flow diagram/, title: () => "Traffic Flow by Health State", span: 2, tall: true },
  { type: "gauge", match: /gauge|health score widget/, title: () => "Network Health", span: 1 },
  { type: "tilemap", match: /tile\s?map|region(al)? map|health map/, title: () => "Regional Health Map", span: 4 },
  { type: "insights", match: /insight|recommendation panel|summary panel/, title: () => "AI Insights", span: 2, tall: true },
  { type: "kpi-grid", match: /kpi/, title: () => "Key Performance Indicators", span: 4, dataKey: () => "generic" },
  { type: "area-trend", match: /alarm (trend|chart|volume)/, title: () => "Alarm Volume Trend", span: 2, dataKey: () => "alarms" },
  {
    type: "table-entities",
    match: /table|list of|worst elements|top.*(element|msan|link|site)/,
    title: (a) => `Top Elements — ${a.measureLabel}`,
    span: 2,
    tall: true,
    dataKey: (q) => (/(saturat|exhaust)/.test(q) ? "saturation" : /(congest)/.test(q) ? "congestion" : "risk"),
  },
  {
    type: "pareto",
    match: /pareto|top \d+|bar chart|top (congested|utilized|risk)/,
    title: (a) => `Top Elements by ${a.measureLabel}`,
    span: 2,
    dataKey: (q) => (/(congest)/.test(q) ? "congestion" : "measure"),
  },
  { type: "trend", match: /trend|over time|time series|line chart/, title: (a) => `${a.measureLabel} Trend`, span: 2, dataKey: () => "regions" },
  { type: "table-regions", match: /region(al)? (table|breakdown|overview)/, title: () => "Regional Breakdown", span: 2 },
];

const PERSONA_WORDS: { match: RegExp; persona: PersonaId }[] = [
  { match: /\bnoc\b|operations view|live view/, persona: "noc" },
  { match: /executive|cto|strategy/, persona: "executive" },
  { match: /capacity (view|planning|tab|dashboard)/, persona: "capacity" },
  { match: /performance (view|tab|dashboard)/, persona: "performance" },
  { match: /assurance|sla view/, persona: "assurance" },
  { match: /overview|network report/, persona: "overview" },
];

/* -------------------------------- parser --------------------------------- */

export function parseActions(
  q: string,
  analysis: AnalysisResult,
  currentWidgets: WidgetSpec[],
  technologies: string[] = []
): DashboardAction[] {
  const query = q.toLowerCase().trim();
  const raw = q.trim();
  const actions: DashboardAction[] = [];

  /* reset intents first */
  if (/reset (the )?(dashboard|layout|widgets)|undo (my )?changes|default layout/.test(query)) {
    actions.push({ kind: "reset-dashboard" });
  }
  if (/reset (the )?filters?|clear (all )?filters?/.test(query)) {
    actions.push({ kind: "reset-filters" });
  }

  /* regions: match names against the query (handles Arabic names verbatim) */
  const wantsRegionScope = /(only|focus|filter|limit|zoom|just|اعرض|ركز|فقط)/.test(query) || /^show /.test(query);
  const matchedRegions = analysis.regionStats
    .map((r) => r.region)
    .filter((name) => raw.toLowerCase().includes(name.toLowerCase()) || raw.includes(name));
  if (matchedRegions.length > 0 && wantsRegionScope) {
    actions.push({ kind: "filter-regions", regions: matchedRegions });
  }
  if (/(all regions|every region|كل المناطق)/.test(query) || /clear region/.test(query)) {
    actions.push({ kind: "filter-regions", regions: [] });
  }

  /* dates */
  const lastN = query.match(/last\s+(\d+)\s*(day|week|month)s?/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const mult = lastN[2] === "week" ? 7 : lastN[2] === "month" ? 30 : 1;
    actions.push({ kind: "filter-dates", lastDays: n * mult });
  } else if (/\b(yesterday|اخر يوم)\b/.test(query)) {
    actions.push({ kind: "filter-dates", lastDays: 1 });
  } else if (/(full window|whole period|entire (period|window)|all (time|days))/.test(query)) {
    actions.push({ kind: "filter-dates", clear: true });
  }

  /* technology */
  for (const t of technologies) {
    if (query.includes(t.toLowerCase()) && /(only|filter|focus|just|show)/.test(query)) {
      actions.push({ kind: "filter-technology", technology: t });
      break;
    }
  }

  /* element search: quoted text or "element(s) like X" */
  const quoted = raw.match(/["“”']([^"“”']{2,40})["“”']/);
  if (quoted && /(element|msan|link|site|search|filter|find)/.test(query)) {
    actions.push({ kind: "filter-search", search: quoted[1] });
  }

  /* persona switching */
  if (/(switch|go|open|take me|change) (to )?|view$|tab$|dashboard$/.test(query)) {
    for (const p of PERSONA_WORDS) {
      if (p.match.test(query) && analysis.dashboards.some((d) => d.persona === p.persona)) {
        actions.push({ kind: "switch-persona", persona: p.persona });
        break;
      }
    }
  }

  /* removal — KPI cards take precedence over whole widgets */
  const removeMatch = query.match(/(remove|delete|hide|drop|احذف|شيل)\s+(the\s+)?(.{3,60})/);
  if (removeMatch) {
    const target = removeMatch[3].replace(/\b(widget|chart|panel|table|graph|card|kpi)\b/g, "").trim();
    const kpiHit = fuzzyKpi(analysis.kpis, target);
    if (kpiHit) {
      actions.push({ kind: "remove-kpi", kpiMatch: kpiHit.name });
    } else {
      const hit = fuzzyWidget(currentWidgets, target);
      if (hit) actions.push({ kind: "remove-widget", titleMatch: hit.title });
      else actions.push({ kind: "remove-widget", titleMatch: target }); // fails with a helpful list
    }
  }

  /* re-add a hidden KPI card: "add the X kpi/card back" */
  const addKpiMatch = query.match(/(add|show|bring back|restore)\s+(the\s+)?(.{3,50}?)\s*(kpi|card)( back)?\b/);
  if (addKpiMatch) {
    const kpiHit = fuzzyKpi(analysis.kpis, addKpiMatch[3]);
    if (kpiHit) actions.push({ kind: "add-kpi", kpiMatch: kpiHit.name });
  }

  /* resize */
  const resizeMatch = query.match(/(make|set|resize)\s+(the\s+)?(.{3,50}?)\s+(bigger|wider|full.?width|larger|smaller|half|narrow)/);
  if (resizeMatch) {
    const hit = fuzzyWidget(currentWidgets, resizeMatch[3]);
    if (hit) {
      const grow = /(bigger|wider|full|larger)/.test(resizeMatch[4]);
      actions.push({ kind: "resize-widget", titleMatch: hit.title, span: grow ? 4 : 2 });
    }
  }

  /* top-N on an existing widget ("show top 20 in the congestion chart") */
  const topN = query.match(/top\s+(\d{1,3})/);

  /* widget addition */
  const wantsAdd = /(add|insert|create|build|new|اضف|أضف)\s/.test(query) || (/^show /.test(query) && /(chart|table|graph|widget|heatmap|histogram|forecast|trend|map|bars)/.test(query));
  if (wantsAdd && !removeMatch && !addKpiMatch) {
    for (const intent of WIDGET_INTENTS) {
      if (intent.match.test(query)) {
        const widget: WidgetSpec = {
          id: uid("w"),
          type: intent.type,
          title: intent.title(analysis),
          span: intent.span,
          tall: intent.tall,
          dataKey: intent.dataKey?.(query),
          limit: topN ? clampN(parseInt(topN[1], 10)) : undefined,
        };
        actions.push({ kind: "add-widget", widget });
        break;
      }
    }
  } else if (topN && !wantsAdd && currentWidgets.length > 0) {
    // adjust an existing pareto/table widget's depth
    const target = currentWidgets.find((w) => (w.type === "pareto" || w.type === "table-entities") && query.split(/\s+/).some((tok) => tok.length > 4 && w.title.toLowerCase().includes(tok)));
    const fallback = currentWidgets.find((w) => w.type === "pareto" || w.type === "table-entities");
    const hit = target ?? fallback;
    if (hit) actions.push({ kind: "set-limit", titleMatch: hit.title, limit: clampN(parseInt(topN[1], 10)) });
  }

  /* dedupe by kind+payload */
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampN(n: number): number {
  return Math.max(3, Math.min(50, Number.isFinite(n) ? n : 10));
}

export function fuzzyKpi(kpis: Kpi[], target: string): Kpi | undefined {
  const t = target.toLowerCase().trim();
  if (t.length < 3) return undefined;
  return (
    kpis.find((k) => k.name.toLowerCase() === t) ??
    kpis.find((k) => k.name.toLowerCase().includes(t) || t.includes(k.name.toLowerCase()))
  );
}

export function fuzzyWidget(widgets: WidgetSpec[], target: string): WidgetSpec | undefined {
  const t = target.toLowerCase().trim();
  if (!t) return undefined;
  const direct = widgets.find((w) => w.title.toLowerCase().includes(t));
  if (direct) return direct;
  // token overlap
  const tokens = t.split(/\s+/).filter((x) => x.length > 3);
  let best: { w: WidgetSpec; hits: number } | null = null;
  for (const w of widgets) {
    const title = w.title.toLowerCase();
    const typeWords = w.type.replace(/-/g, " ");
    const hits = tokens.filter((tok) => title.includes(tok) || typeWords.includes(tok)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { w, hits };
  }
  return best?.w;
}

/* ------------------------- widget list application ----------------------- */

export function applyWidgetActions(
  widgets: WidgetSpec[],
  actions: DashboardAction[],
  kpis: Kpi[] = []
): { widgets: WidgetSpec[]; applied: string[]; failed: string[]; changed: boolean } {
  let list = [...widgets];
  const applied: string[] = [];
  const failed: string[] = [];
  let changed = false;
  const available = () => `Available widgets: ${list.map((w) => `"${w.title}"`).join(", ")}`;

  for (const a of actions) {
    switch (a.kind) {
      case "add-widget": {
        list = [...list, a.widget];
        applied.push(`Added "${a.widget.title}"${a.widget.limit ? ` (top ${a.widget.limit})` : ""}`);
        changed = true;
        break;
      }
      case "remove-kpi": {
        const kpi = fuzzyKpi(kpis, a.kpiMatch);
        const grids = list.filter((w) => w.type === "kpi-grid");
        if (kpi && grids.length > 0) {
          list = list.map((w) =>
            w.type === "kpi-grid"
              ? { ...w, excludeKpis: [...(w.excludeKpis ?? []), kpi.name], extraKpis: (w.extraKpis ?? []).filter((x) => x !== kpi.name) }
              : w
          );
          applied.push(`Removed the "${kpi.name}" KPI card`);
          changed = true;
        } else {
          failed.push(
            kpi ? "No KPI grid on this dashboard" : `No KPI matching "${a.kpiMatch}". Available KPIs: ${kpis.map((k) => k.name).join(", ")}`
          );
        }
        break;
      }
      case "add-kpi": {
        const kpi = fuzzyKpi(kpis, a.kpiMatch);
        const grids = list.filter((w) => w.type === "kpi-grid");
        if (kpi && grids.length > 0) {
          list = list.map((w) =>
            w.type === "kpi-grid"
              ? {
                  ...w,
                  excludeKpis: (w.excludeKpis ?? []).filter((x) => x.toLowerCase() !== kpi.name.toLowerCase()),
                  extraKpis: [...new Set([...(w.extraKpis ?? []), kpi.name])],
                }
              : w
          );
          applied.push(`Added the "${kpi.name}" KPI card`);
          changed = true;
        } else {
          failed.push(kpi ? "No KPI grid on this dashboard" : `No KPI matching "${a.kpiMatch}". Available KPIs: ${kpis.map((k) => k.name).join(", ")}`);
        }
        break;
      }
      case "remove-widget": {
        const hit = fuzzyWidget(list, a.titleMatch);
        if (hit) {
          list = list.filter((w) => w.id !== hit.id);
          applied.push(`Removed "${hit.title}"`);
          changed = true;
        } else failed.push(`No widget matching "${a.titleMatch}". ${available()}`);
        break;
      }
      case "resize-widget": {
        const hit = fuzzyWidget(list, a.titleMatch);
        if (hit) {
          list = list.map((w) => (w.id === hit.id ? { ...w, span: a.span } : w));
          applied.push(`Resized "${hit.title}" to ${a.span === 4 ? "full width" : `${a.span}/4 width`}`);
          changed = true;
        } else failed.push(`No widget matching "${a.titleMatch}". ${available()}`);
        break;
      }
      case "set-limit": {
        const hit = fuzzyWidget(list, a.titleMatch);
        if (hit) {
          list = list.map((w) => (w.id === hit.id ? { ...w, limit: a.limit } : w));
          applied.push(`"${hit.title}" now shows top ${a.limit}`);
          changed = true;
        } else failed.push(`No widget matching "${a.titleMatch}". ${available()}`);
        break;
      }
      default:
        break;
    }
  }
  return { widgets: list, applied, failed, changed };
}

/* ------------------------------ descriptions ----------------------------- */

export function describeAction(a: DashboardAction): string {
  switch (a.kind) {
    case "filter-regions":
      return a.regions.length === 0 ? "Show all regions" : `Filter to ${a.regions.join(", ")}`;
    case "filter-dates":
      return a.clear ? "Show the full time window" : `Show the last ${a.lastDays} day${a.lastDays === 1 ? "" : "s"}`;
    case "filter-search":
      return `Filter elements matching "${a.search}"`;
    case "filter-technology":
      return a.technology ? `Filter to ${a.technology}` : "Show all technologies";
    case "reset-filters":
      return "Reset all filters";
    case "switch-persona":
      return `Switch to the ${PERSONAS.find((p) => p.id === a.persona)?.label ?? a.persona} dashboard`;
    case "add-widget":
      return `Add "${a.widget.title}"${a.widget.limit ? ` (top ${a.widget.limit})` : ""}`;
    case "remove-widget":
      return `Remove "${a.titleMatch}"`;
    case "resize-widget":
      return `Resize "${a.titleMatch}"`;
    case "set-limit":
      return `Show top ${a.limit} in "${a.titleMatch}"`;
    case "remove-kpi":
      return `Remove the "${a.kpiMatch}" KPI card`;
    case "add-kpi":
      return `Add the "${a.kpiMatch}" KPI card`;
    case "reset-dashboard":
      return "Reset the dashboard to the AI-generated layout";
  }
}
