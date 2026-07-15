import { chatOnce } from "./ollamaClient";
import { profileDataset, toEpoch, toNum } from "@/agents/profiling";
import type { ColumnProfile, Dataset, DomainScore, Row, SemanticMapping } from "@/lib/types";

/* ------------------------------------------------------------------------
 * LLM Data Understanding agent.
 * For files the heuristics can't map confidently (foreign-language headers,
 * wide multi-period reports, exotic schemas), the local LLM proposes a
 * transformation plan: semantic mapping + optional wide→long unpivot.
 * Every decision is validated deterministically before being applied;
 * anything invalid is discarded and the heuristic result stands.
 * ---------------------------------------------------------------------- */

export interface AssistOutcome {
  dataset: Dataset;
  profile: ColumnProfile[];
  mapping: SemanticMapping;
  note: string;
}

export function needsAssist(mapping: SemanticMapping, domains: DomainScore[]): boolean {
  // heuristics lack an anchor: nothing to measure, or nothing to group by
  const noAnchor = !mapping.primaryMeasure || (!mapping.entity && !mapping.region);
  const weakDomain = (domains[0]?.confidence ?? 0) < 70;
  return noAnchor || weakDomain;
}

/* ------------------------------- LLM call -------------------------------- */

interface PlanJson {
  entity?: string | null;
  region?: string | null;
  timestamp?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  subscribers?: string | null;
  utilization?: string | null;
  capacity?: string | null;
  alarms?: string | null;
  primary_measure?: string | null;
  higher_is_bad?: boolean;
  wide_groups?: {
    date?: string | null;
    date_column?: string | null;
    columns?: Record<string, string>;
  }[];
  keep_columns?: string[];
  note?: string;
}

const SYSTEM = `You are the data-understanding agent of a telecom network analytics platform. You receive the column inventory of an uploaded table (headers may be in any language, including Arabic) and must return a transformation plan as STRICT JSON — no prose, no markdown.

JSON schema:
{
 "entity": "column holding the network element / item identifier (prefer hostname or code), or null",
 "region": "column holding the geographic/organizational grouping, or null",
 "timestamp": "column holding the record timestamp (long-format tables only), or null",
 "latitude": "numeric latitude column, or null",
 "longitude": "numeric longitude/lng/lon column, or null",
 "subscribers": "column with subscriber/customer counts, or null",
 "utilization": "column with utilization PERCENT (values 0-100), or null",
 "capacity": "column with capacity (ports/Mbps), or null",
 "alarms": "column with alarm counts, or null",
 "primary_measure": "the single most important metric column (or new measure name if using wide_groups), or null",
 "higher_is_bad": true if larger primary_measure values mean worse service (e.g. minutes in critical state, alarms, loss), else false,
 "wide_groups": [],
 "keep_columns": [],
 "note": "one short sentence describing what you did"
}

wide_groups — IMPORTANT: many reports repeat the same measures across several time periods as column GROUPS (e.g. day-1 columns, day-2 columns, or per-date columns). If the same metric appears 2+ times under period-variant names, you MUST fill wide_groups: one group per period, using the SAME clean measure keys in every group. Each group: {"date": "YYYY-MM-DD" or null, "date_column": "column whose row value gives this period's date" or null, "columns": {"clean_measure_name": "source column", ...}}.

EXAMPLE — input columns: site, visitors, report_date_d1 (sample 2026-03-09), kpi_a_d1, kpi_b_d1, report_date_d2 (sample 2026-03-08), kpi_a_d2, kpi_b_d2, kpi_a_today, kpi_b_today
→ "wide_groups": [
 {"date": null, "date_column": "report_date_d1", "columns": {"kpi_a": "kpi_a_d1", "kpi_b": "kpi_b_d1"}},
 {"date": null, "date_column": "report_date_d2", "columns": {"kpi_a": "kpi_a_d2", "kpi_b": "kpi_b_d2"}},
 {"date": "2026-03-10", "date_column": null, "columns": {"kpi_a": "kpi_a_today", "kpi_b": "kpi_b_today"}}
]
(the 'today' group got a literal date one day after the newest dated group). If the table is NOT wide-per-period, return "wide_groups": [].

Rules: only reference column names that EXACTLY appear in the inventory. utilization must really be a 0-100 percent — if no such column exists, return null. Respond with the JSON object only.`;

function buildUserPrompt(dataset: Dataset, profile: ColumnProfile[]): string {
  const lines = profile.map((p) => {
    const stats =
      p.role === "numeric"
        ? ` min=${fmt(p.min)} max=${fmt(p.max)} mean=${fmt(p.mean)}`
        : ` distinct=${p.distinct}`;
    return `- "${p.name}" [${p.role}]${stats} samples: ${p.samples.slice(0, 3).join(" | ").slice(0, 110)}`;
  });
  const sampleRows = dataset.rows.slice(0, 2).map((r) => JSON.stringify(r).slice(0, 700));
  return `TABLE: ${dataset.name} — ${dataset.rowCount} rows\n\nCOLUMNS:\n${lines.join("\n")}\n\nSAMPLE ROWS:\n${sampleRows.join("\n")}\n\nReturn the transformation plan JSON.`;
}

function fmt(x?: number): string {
  if (x === undefined || Number.isNaN(x)) return "?";
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
}

/* ------------------------- validation + application ---------------------- */

export async function runMappingAssist(
  dataset: Dataset,
  profile: ColumnProfile[],
  llm: { baseUrl: string; model: string }
): Promise<AssistOutcome | null> {
  let plan: PlanJson | null = null;
  try {
    const raw = await chatOnce({
      baseUrl: llm.baseUrl,
      model: llm.model,
      json: true,
      temperature: 0.15,
      maxTokens: 800,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(dataset, profile) },
      ],
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    plan = JSON.parse(raw.slice(start, end + 1)) as PlanJson;
  } catch {
    return null;
  }
  if (!plan) return null;
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lastPlan = plan;

  const colSet = new Set(dataset.columns);
  const col = (c?: string | null): string | undefined => (c && colSet.has(c) ? c : undefined);
  const numericCol = (c?: string | null): string | undefined => {
    const name = col(c);
    if (!name) return undefined;
    return profile.find((p) => p.name === name)?.role === "numeric" ? name : undefined;
  };

  /* ------------------------------ unpivot ------------------------------- */
  let ds = dataset;
  let reshaped = false;
  let measureKeys: string[] = [];
  const groups = (plan.wide_groups ?? []).filter((g) => g && g.columns && typeof g.columns === "object");
  if (groups.length >= 2) {
    // validate groups: every measure source must exist + be numeric; resolve a timestamp per group
    type ValidGroup = { t: ((row: Row) => number | null) | null; measures: Record<string, string>; dateCol?: string };
    const valid: ValidGroup[] = [];
    const keySet = new Set<string>();
    for (const g of groups) {
      const measures: Record<string, string> = {};
      for (const [k, src] of Object.entries(g.columns!)) {
        const clean = String(k).trim().replace(/[^\w ]/g, "").slice(0, 40);
        const srcCol = numericCol(src);
        if (clean && srcCol) {
          measures[clean] = srcCol;
          keySet.add(clean);
        }
      }
      if (Object.keys(measures).length === 0) continue;
      const dateCol = col(g.date_column);
      const literal = g.date ? toEpoch(g.date) : null;
      if (dateCol) {
        valid.push({ t: (row) => toEpoch(row[dateCol]), measures, dateCol });
      } else if (literal !== null) {
        valid.push({ t: () => literal, measures });
      } else {
        valid.push({ t: null, measures }); // date resolved ordinally below
      }
    }
    // ordinal fallback: undated groups get (newest known date) + k days, in listed order
    const knownDates = valid
      .map((g) => (g.dateCol ? toEpoch(dataset.rows[0]?.[g.dateCol]) : g.t ? g.t({}) : null))
      .filter((x): x is number => x !== null);
    let anchor = knownDates.length ? Math.max(...knownDates) : Date.now() - valid.length * 86400_000;
    for (const g of valid) {
      if (g.t === null) {
        anchor += 86400_000;
        const fixed = anchor;
        g.t = () => fixed;
      }
    }
    measureKeys = [...keySet];
    if (valid.length >= 2 && measureKeys.length >= 1) {
      const groupSources = new Set(valid.flatMap((g) => Object.values(g.measures)));
      const groupDateCols = new Set(valid.map((g) => g.dateCol).filter(Boolean) as string[]);
      // keep every non-group column — never trust the plan's keep list
      const keep = dataset.columns.filter((c) => !groupSources.has(c) && !groupDateCols.has(c));
      const rows: Row[] = [];
      const finalGroups = valid.map((g) => ({ t: g.t!, measures: g.measures }));
      for (const r of dataset.rows) {
        for (const g of finalGroups) {
          const t = g.t(r);
          if (t === null) continue;
          const o: Row = {};
          for (const k of keep) o[k] = r[k];
          o["Timestamp"] = new Date(t).toISOString();
          for (const mk of measureKeys) {
            const src = g.measures[mk];
            o[mk] = src ? toNum(r[src]) : null;
          }
          rows.push(o);
          if (rows.length >= 240_000) break;
        }
        if (rows.length >= 240_000) break;
      }
      if (rows.length >= dataset.rowCount) {
        // keep the original id — the store and analyses are keyed by it
        ds = {
          ...dataset,
          rows,
          rowCount: rows.length,
          columns: Object.keys(rows[0]),
        };
        reshaped = true;
      }
    }
  }

  /* --------------------- re-profile + apply mapping patch ------------------ */
  const reProfiled = profileDataset(ds);
  ds = reProfiled.dataset;
  const newProfile = reProfiled.profile;
  const mapping = reProfiled.mapping;
  const newColSet = new Set(ds.columns);
  const ncol = (c?: string | null): string | undefined => (c && newColSet.has(c) ? c : undefined);
  const nNumeric = (c?: string | null): string | undefined => {
    const name = ncol(c);
    return name && newProfile.find((p) => p.name === name)?.role === "numeric" ? name : undefined;
  };

  const entity = ncol(plan.entity);
  if (entity) mapping.entity = entity;
  const region = ncol(plan.region);
  if (region) {
    const rp = newProfile.find((p) => p.name === region);
    if (rp && rp.distinct >= 2 && rp.distinct <= 80) mapping.region = region;
  }
  if (!reshaped) {
    const ts = ncol(plan.timestamp);
    if (ts && newProfile.find((p) => p.name === ts)?.role === "datetime") mapping.timestamp = ts;
  }
  const latitude = nNumeric(plan.latitude);
  if (latitude) mapping.latitude = latitude;
  const longitude = nNumeric(plan.longitude);
  if (longitude) mapping.longitude = longitude;
  const subs = nNumeric(plan.subscribers);
  if (subs) mapping.subscribers = subs;
  const cap = nNumeric(plan.capacity);
  if (cap) mapping.capacity = cap;
  const alarms = nNumeric(plan.alarms);
  if (alarms) mapping.alarms = alarms;
  const util = nNumeric(plan.utilization);
  if (util) {
    const p = newProfile.find((x) => x.name === util)!;
    if ((p.min ?? 0) >= -0.01 && (p.p95 ?? p.max ?? 0) <= 100.5) mapping.utilization = util;
  }

  // primary measure: a reshaped measure key or any numeric column
  const pm = nNumeric(plan.primary_measure) ?? (measureKeys.includes(String(plan.primary_measure)) ? String(plan.primary_measure) : undefined);
  if (pm && pm !== mapping.subscribers) mapping.primaryMeasure = mapping.utilization ?? pm;
  if (typeof plan.higher_is_bad === "boolean" && !mapping.utilization) {
    mapping.measureHigherIsBad = plan.higher_is_bad;
  }

  const note = reshaped
    ? `Local LLM reshaped ${groups.length} wide column groups into a ${ds.rowCount}-row time series${plan.note ? ` — ${String(plan.note).slice(0, 120)}` : ""}`
    : `Local LLM refined the semantic mapping${plan.note ? ` — ${String(plan.note).slice(0, 120)}` : ""}`;

  return { dataset: ds, profile: newProfile, mapping, note };
}
