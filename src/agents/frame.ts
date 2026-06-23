import { isAggregateLabel, measureKind, toEpoch, toNum } from "./profiling";
import type { Dataset, SemanticMapping } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Columnar frame extracted once per analysis run; all downstream agents
 * operate on these parsed arrays instead of re-reading raw rows.
 * ---------------------------------------------------------------------- */

export interface Frame {
  n: number;
  t: (number | null)[];
  entity: string[] | null;
  region: string[] | null;
  technology: string[] | null;
  vendor: string[] | null;
  util: (number | null)[] | null;
  traffic: (number | null)[] | null;
  capacity: (number | null)[] | null;
  subscribers: (number | null)[] | null;
  alarms: (number | null)[] | null;
  criticalAlarms: (number | null)[] | null;
  availability: (number | null)[] | null;
  latency: (number | null)[] | null;
  packetLoss: (number | null)[] | null;
  measure: (number | null)[] | null;
  measureName: string;
  /** stock (point-in-time level) vs flow (accumulates over a period) */
  measureKind: "stock" | "flow";
  hasTime: boolean;
  timeStart: number;
  timeEnd: number;
  entities: string[];
  regions: string[];
  /** per-row: true when the entity value is a grand-total / aggregate ("active", "total"…) */
  aggregateMask: boolean[] | null;
  /** true when any aggregate rows were detected and excluded from breakdowns */
  hasAggregateRows: boolean;
}

export function extractFrame(dataset: Dataset, mapping: SemanticMapping): Frame {
  const rows = dataset.rows;
  const n = rows.length;

  const numCol = (col?: string): (number | null)[] | null => {
    if (!col) return null;
    const out = new Array<number | null>(n);
    for (let i = 0; i < n; i++) out[i] = toNum(rows[i][col]);
    return out;
  };
  const strCol = (col?: string): string[] | null => {
    if (!col) return null;
    const out = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const v = rows[i][col];
      out[i] = v === null || v === undefined ? "Unknown" : String(v);
    }
    return out;
  };

  const t = new Array<number | null>(n);
  let timeStart = Infinity;
  let timeEnd = -Infinity;
  if (mapping.timestamp) {
    for (let i = 0; i < n; i++) {
      const e = toEpoch(rows[i][mapping.timestamp]);
      t[i] = e;
      if (e !== null) {
        if (e < timeStart) timeStart = e;
        if (e > timeEnd) timeEnd = e;
      }
    }
  } else {
    t.fill(null);
  }
  const hasTime = Number.isFinite(timeStart) && timeEnd > timeStart;

  const util = numCol(mapping.utilization);
  const measureCol = mapping.primaryMeasure === mapping.utilization ? util : numCol(mapping.primaryMeasure);

  const entity = strCol(mapping.entity);
  const region = strCol(mapping.region);

  // aggregate-row detection: a category value that is a grand total ("active",
  // "total"…) or — when there's no time axis — a value whose measure magnitude
  // dwarfs the rest. Such rows are excluded from per-entity breakdowns.
  let aggregateMask: boolean[] | null = null;
  let hasAggregateRows = false;
  if (entity) {
    aggregateMask = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (isAggregateLabel(entity[i])) {
        aggregateMask[i] = true;
        hasAggregateRows = true;
      }
    }
  }

  const realEntity = (i: number) => !aggregateMask || !aggregateMask[i];
  const entities = entity ? uniqueLimited(entity.filter((_, i) => realEntity(i)), 5000) : [];
  const regions = region ? uniqueLimited(region.filter((_, i) => realEntity(i)), 200) : [];

  return {
    n,
    t,
    entity,
    region,
    technology: strCol(mapping.technology),
    vendor: strCol(mapping.vendor),
    util,
    traffic: numCol(mapping.traffic),
    capacity: numCol(mapping.capacity),
    subscribers: numCol(mapping.subscribers),
    alarms: numCol(mapping.alarms),
    criticalAlarms: numCol(mapping.criticalAlarms),
    availability: numCol(mapping.availability),
    latency: numCol(mapping.latency),
    packetLoss: numCol(mapping.packetLoss),
    measure: measureCol,
    measureName: mapping.primaryMeasure ?? "Value",
    measureKind: mapping.primaryMeasure
      ? mapping.primaryMeasure === mapping.utilization
        ? "stock"
        : measureKind(mapping.primaryMeasure)
      : "flow",
    hasTime,
    timeStart: hasTime ? timeStart : 0,
    timeEnd: hasTime ? timeEnd : 0,
    entities,
    regions,
    aggregateMask,
    hasAggregateRows,
  };
}

function uniqueLimited(values: string[], limit: number): string[] {
  const set = new Set<string>();
  for (const v of values) {
    set.add(v);
    if (set.size >= limit) break;
  }
  return [...set].sort();
}

export const DAY_MS = 24 * 3600_000;

export function dayIndexOf(t: number, start: number): number {
  return Math.floor((t - start) / DAY_MS);
}
