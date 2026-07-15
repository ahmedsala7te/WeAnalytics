import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { mean, percentile, std } from "@/lib/stats";
import type { CellValue, ColumnProfile, ColumnRole, Dataset, Row, SemanticMapping, SemanticTag } from "@/lib/types";

dayjs.extend(customParseFormat);

/* ------------------------------------------------------------------------
 * Agent 2 — Data Profiling
 * Infers column roles (datetime / numeric / categorical / identifier),
 * computes quality stats and maps columns to telecom semantics.
 * ---------------------------------------------------------------------- */

const DATE_FORMATS = [
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYY-MM-DD",
  "YYYY/MM/DD HH:mm",
  "YYYY/MM/DD",
  "DD/MM/YYYY HH:mm",
  "DD/MM/YYYY",
  "DD-MM-YYYY HH:mm",
  "DD-MM-YYYY",
  "MM/DD/YYYY HH:mm",
  "MM/DD/YYYY",
  "DD MMM YYYY",
  "YYYYMMDD",
];

const epochCache = new Map<string, number | null>();

export function toEpoch(v: CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (v > 1e12 && v < 4e12) return v; // ms epoch
    if (v > 1e9 && v < 4e9) return v * 1000; // s epoch
    if (v > 25569 && v < 80000) return Math.round((v - 25569) * 86400000); // Excel serial
    return null;
  }
  const s = String(v).trim();
  if (s.length < 6) return null;
  const cached = epochCache.get(s);
  if (cached !== undefined) return cached;

  let t: number | null = null;
  // Fast path: ISO-like
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    // Preserve explicit ISO timezone information. Treating a trailing Z value
    // as local time shifts midnight dates backwards in positive UTC zones.
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
    t = hasExplicitZone
      ? Date.parse(s)
      : new Date(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4] ?? 0),
          Number(m[5] ?? 0),
          Number(m[6] ?? 0)
        ).getTime();
  } else {
    for (const f of DATE_FORMATS) {
      const d = dayjs(s, f, true);
      if (d.isValid()) {
        t = d.valueOf();
        break;
      }
    }
    // Native Date.parse is a last resort and only for strings that plausibly
    // look like dates. V8 happily parses IDs like "ALX-MSAN-001" as year 2001.
    if (t === null && /^(\d|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun))/i.test(s)) {
      const native = Date.parse(s);
      t = Number.isNaN(native) ? null : native;
    }
  }
  if (t !== null && (t < Date.UTC(1990, 0, 1) || t > Date.UTC(2045, 0, 1))) t = null;
  if (epochCache.size < 200_000) epochCache.set(s, t);
  return t;
}

export function toNum(v: CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[%,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------- Semantic matching -------------------------- */

function norm(name: string): string {
  // keep Arabic letters so multilingual headers can match the dictionaries
  return name.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
}

const SEMANTIC_RULES: { tag: SemanticTag; test: (n: string) => boolean; priority: number }[] = [
  { tag: "latitude", priority: 11, test: (n) => /^(lat|latitude|sitelat|gpslat|gpsy|ycoord|ycoordinate|northing)$/.test(n) },
  { tag: "longitude", priority: 11, test: (n) => /^(lng|lon|long|longitude|sitelng|sitelon|gpslng|gpslon|gpsx|xcoord|xcoordinate|easting)$/.test(n) },
  { tag: "critical_alarms", priority: 10, test: (n) => /critical/.test(n) && /(alarm|trap|fault|count)/.test(n) },
  { tag: "alarms", priority: 9, test: (n) => (/(alarm|trap|fault|incident)/.test(n) && !/critical/.test(n)) || /(انذار|إنذار|بلاغ)/.test(n) },
  { tag: "utilization", priority: 10, test: (n) => /(util|occupanc)/.test(n) || /(استغلال|استخدام|اشغال|إشغال)/.test(n) },
  { tag: "availability", priority: 9, test: (n) => /(avail|uptime)/.test(n) || /(اتاحة|إتاحة|توافر)/.test(n) },
  { tag: "packet_loss", priority: 9, test: (n) => /(packetloss|loss|discard|drop)/.test(n) && !/lossless/.test(n) },
  { tag: "latency", priority: 9, test: (n) => /(latency|delay|rtt|pingms)/.test(n) },
  { tag: "capacity", priority: 8, test: (n) => (/(capacity|bandwidth|linkspeed|speedmbps)/.test(n) && !/used/.test(n)) || /(سعة|سعه)/.test(n) },
  { tag: "traffic", priority: 8, test: (n) => /(traffic|throughput|mbps|gbps|kbps|erlang|volume|datausage)/.test(n) && !/capacity/.test(n) },
  { tag: "subscribers", priority: 8, test: (n) => /(subscriber|customer|attachedusers|activeusers)/.test(n) || /(مشترك|مشتركين|عملاء)/.test(n) },
  {
    tag: "timestamp",
    priority: 8,
    test: (n) =>
      (/(timestamp|datetime|date|time|period|reportday|day)$/.test(n) ||
        /^(timestamp|datetime|date|time|period|reportdate)/.test(n) ||
        /(تاريخ|وقت)/.test(n)) &&
      // "average_critical_time", "downtime"… are durations, not timestamps
      !/(critical|warning|average|avg|mean|total|sum|duration|down|hold|response|mttr|outage)/.test(n),
  },
  { tag: "region", priority: 8, test: (n) => /(region|governorate|zone|province|state|territory|cluster)/.test(n) || /(منطقة|منطقه|محافظة|محافظه|اقليم|إقليم)/.test(n) },
  { tag: "city", priority: 7, test: (n) => /(city|town|district|exchange|site(name)?$)/.test(n) || /(مدينة|مدينه|حي|سنترال)/.test(n) },
  { tag: "severity", priority: 7, test: (n) => /severity/.test(n) || /(خطورة|خطوره|اهمية|أهمية)/.test(n) },
  { tag: "technology", priority: 7, test: (n) => /(tech|technology|accesstype)/.test(n) || /تقنية/.test(n) },
  { tag: "vendor", priority: 7, test: (n) => /(vendor|supplier|manufacturer|oem)/.test(n) || /(مورد|شركة)/.test(n) },
  { tag: "interface", priority: 7, test: (n) => /(interface|port|uplink)/.test(n) && !/linkid/.test(n) },
  {
    tag: "entity",
    priority: 6,
    test: (n) =>
      /(msan|dslam|olt|onu|node|cell|sector|link|nename|neid|element|device|host(name)?|router|switch|bts|enodeb|gnodeb|site_?id|siteid|storeid|store|branch)/.test(n) ||
      /(كبينة|كابينة|قطاع|عنصر)/.test(n) ||
      /id$/.test(n),
  },
  { tag: "revenue", priority: 6, test: (n) => /(revenue|sales|amount|price|cost|egp|usd|eur)/.test(n) || /(ايراد|إيراد|مبيعات)/.test(n) },
  { tag: "quantity", priority: 5, test: (n) => /(units|qty|quantity|orders|visits)/.test(n) || /(عدد|كمية)/.test(n) },
];

/** Larger values of this measure are worse (used for ranking + health). */
export function measureLooksBad(name: string): boolean {
  const n = norm(name);
  return /(critical|warning|alarm|fault|outage|down|loss|drop|discard|error|fail|congest|complaint|churn|delay|latency|mttr)/.test(n) || /(انذار|إنذار|عطل|اعطال|أعطال|انقطاع)/.test(n);
}

/**
 * A category value that is a grand-total / aggregate rather than a real member
 * (e.g. "active", "total", "all", "grand total"). Such rows must be excluded
 * from per-entity breakdowns or they dwarf every real category.
 */
export function isAggregateLabel(s: string): boolean {
  const n = s.toLowerCase().trim();
  return /^(active|total|totals|all|all elements|grand ?total|overall|sum|aggregate|combined|consolidated|إجمالي|الإجمالي|اجمالي|الاجمالي|الكل|المجموع|اجمالى)$/.test(n);
}

/**
 * Stock vs flow classification of a numeric measure.
 *  - "stock": a level/count measured at a point in time (subscribers, headcount,
 *    utilization %, availability) — aggregate over TIME by latest/mean, never sum.
 *  - "flow": an amount accumulated over a period (volume, traffic, revenue,
 *    units, calls, alarms) — sum or daily-average over time.
 */
export function measureKind(name: string, semantic?: SemanticTag): "stock" | "flow" {
  if (semantic === "subscribers" || semantic === "utilization" || semantic === "availability" || semantic === "capacity") return "stock";
  if (semantic === "traffic" || semantic === "alarms" || semantic === "critical_alarms" || semantic === "revenue" || semantic === "quantity") return "flow";
  const n = norm(name);
  // An explicitly averaged/mean measure is already normalized for its period.
  // Summing it across elements creates a mathematically valid but operationally
  // meaningless "total of averages" (for example average critical minutes).
  if (/(average|avg|mean|median)/.test(n)) return "stock";
  if (/(subscriber|customer|user|headcount|count|active|level|inventory|stock|balance|ratio|percent|score|util|occupanc|avail|temperature|gauge|onhand|مشترك|عملاء|عدد)/.test(n)) return "stock";
  if (/(volume|traffic|throughput|revenue|sales|units|sold|amount|orders|visits|calls|minutes|requests|bytes|tib|tb|gb|mb|kb|erlang|usage|consumption|تداول|استهلاك|حجم)/.test(n)) return "flow";
  return "flow";
}

function matchSemantic(name: string): { tag: SemanticTag; priority: number } {
  const n = norm(name);
  let best: { tag: SemanticTag; priority: number } = { tag: "none", priority: 0 };
  for (const rule of SEMANTIC_RULES) {
    if (rule.priority > best.priority && rule.test(n)) best = { tag: rule.tag, priority: rule.priority };
  }
  return best;
}

/* ------------------------------ Profiling ------------------------------- */

const SAMPLE_LIMIT = 4000;

export interface ProfilingOutput {
  dataset: Dataset;
  profile: ColumnProfile[];
  mapping: SemanticMapping;
}

export function profileDataset(input: Dataset): ProfilingOutput {
  const dataset = maybeUnpivotBlockColumns(maybeUnpivotDateColumns(maybeUnpivotHourColumns(input)));
  const rows = dataset.rows;
  const n = rows.length;
  const step = Math.max(1, Math.floor(n / SAMPLE_LIMIT));

  const profile: ColumnProfile[] = dataset.columns.map((name) => {
    let nulls = 0;
    let numericCount = 0;
    let dateCount = 0;
    let checked = 0;
    const nums: number[] = [];
    const distinct = new Set<string>();
    const samples: string[] = [];

    for (let i = 0; i < n; i += step) {
      const v = rows[i][name];
      checked++;
      if (v === null || v === undefined || v === "") {
        nulls++;
        continue;
      }
      const num = toNum(v);
      if (num !== null && !(typeof v === "string" && /[a-z]{3,}/i.test(v))) {
        numericCount++;
        nums.push(num);
      }
      if (typeof v === "string" || (typeof v === "number" && num !== null && num > 25569)) {
        if (toEpoch(v) !== null) dateCount++;
      }
      const sv = String(v);
      if (distinct.size < 10_000) distinct.add(sv);
      if (samples.length < 5 && !samples.includes(sv)) samples.push(sv);
    }

    const valid = checked - nulls;
    const sem = matchSemantic(name);
    let role: ColumnRole;
    const nameIsTimey = sem.tag === "timestamp";
    // ID-like columns (entity/interface semantics) never take the datetime
    // role on value evidence alone — element names often false-parse as dates
    const idLike = sem.tag === "entity" || sem.tag === "interface";
    if (valid > 0 && dateCount / valid >= 0.8 && (nameIsTimey || (numericCount / valid < 0.8 && !idLike))) {
      role = "datetime";
    } else if (valid > 0 && numericCount / valid >= 0.85) {
      role = "numeric";
    } else if (distinct.size <= Math.max(60, valid * 0.05)) {
      role = "categorical";
    } else if (distinct.size / Math.max(1, valid) > 0.5) {
      role = "identifier";
    } else {
      role = "text";
    }
    // numeric columns named like timestamps but small values are still numeric
    if (role === "datetime" && valid > 0 && dateCount / valid < 0.5) role = "numeric";

    const p: ColumnProfile = {
      name,
      role,
      semantic: sem.tag,
      distinct: distinct.size,
      nullPct: checked ? (nulls / checked) * 100 : 0,
      samples,
    };
    if (role === "numeric" && nums.length > 0) {
      p.min = Math.min(...nums.slice(0, 20000));
      p.max = Math.max(...nums.slice(0, 20000));
      p.mean = mean(nums);
      p.std = std(nums);
      p.p95 = percentile(nums, 95);
    }
    return p;
  });

  const mapping = buildMapping(profile, dataset);
  return { dataset, profile, mapping };
}

function pickBest(profile: ColumnProfile[], tag: SemanticTag, role?: ColumnRole[]): ColumnProfile | undefined {
  const candidates = profile.filter(
    (p) => p.semantic === tag && (!role || role.includes(p.role)) && p.nullPct < 60
  );
  return candidates[0];
}

function buildMapping(profile: ColumnProfile[], dataset: Dataset): SemanticMapping {
  const mapping: SemanticMapping = { measures: [] };

  // timestamp: prefer datetime-role columns
  const ts =
    profile.find((p) => p.role === "datetime" && p.semantic === "timestamp") ??
    profile.find((p) => p.role === "datetime");
  if (ts) mapping.timestamp = ts.name;

  // region: ONLY a genuine geography dimension (semantic match). A plain
  // low-cardinality categorical like "Service Plan" is a breakdown dimension,
  // not a region — it becomes the entity below.
  let regionName = pickBest(profile, "region", ["categorical", "identifier", "text"])?.name;
  mapping.city = pickBest(profile, "city")?.name;
  mapping.latitude = pickBest(profile, "latitude", ["numeric"])?.name;
  mapping.longitude = pickBest(profile, "longitude", ["numeric"])?.name;

  // entity: the dimension the analysis is broken down by. Prefer a semantic
  // entity/identifier; otherwise any plain categorical (incl. low-cardinality).
  const entityRank = (p: ColumnProfile) =>
    p.semantic === "entity" ? 3 : p.semantic === "interface" ? 2 : p.semantic === "none" ? 1 : 0;
  const isDimension = (p: ColumnProfile) =>
    (p.role === "categorical" || p.role === "identifier") &&
    p.distinct >= 2 &&
    p.name !== regionName &&
    p.name !== mapping.city &&
    !["technology", "vendor", "severity"].includes(p.semantic);
  const dims = profile.filter(isDimension).sort((a, b) => entityRank(b) - entityRank(a) || b.distinct - a.distinct);
  if (dims[0]) mapping.entity = dims[0].name;

  // if there's no geographic region but multiple breakdown dimensions, the
  // lowest-cardinality remaining one acts as the grouping (region) axis.
  if (!regionName) {
    const groupDim = dims.filter((p) => p.name !== mapping.entity).sort((a, b) => a.distinct - b.distinct)[0];
    if (groupDim) regionName = groupDim.name;
  }
  if (regionName) mapping.region = regionName;

  const numericByTag = (tag: SemanticTag) =>
    profile.find((p) => p.semantic === tag && p.role === "numeric" && p.nullPct < 60)?.name;

  // utilization must actually behave like a percentage
  const utilCand = profile.find((p) => p.semantic === "utilization" && p.role === "numeric" && p.nullPct < 60);
  if (utilCand) {
    const p95 = utilCand.p95 ?? utilCand.max ?? 0;
    const min = utilCand.min ?? 0;
    if (min >= -0.01 && p95 <= 1.001 && (utilCand.mean ?? 0) > 0.005 && (utilCand.max ?? 0) <= 1.2) {
      // stored as fraction 0–1 → materialize a ×100 column
      const colName = `${utilCand.name} (%)`;
      for (const r of dataset.rows) {
        const v = toNum(r[utilCand.name]);
        r[colName] = v === null ? null : Math.min(100, v * 100);
      }
      if (!dataset.columns.includes(colName)) dataset.columns.push(colName);
      profile.push({ ...utilCand, name: colName, min: (utilCand.min ?? 0) * 100, max: (utilCand.max ?? 0) * 100, mean: (utilCand.mean ?? 0) * 100, std: (utilCand.std ?? 0) * 100, p95: (utilCand.p95 ?? 0) * 100 });
      mapping.utilization = colName;
    } else if (min >= -0.01 && p95 <= 100.5 && (utilCand.max ?? 0) <= 120) {
      mapping.utilization = utilCand.name; // genuine percent
    }
    // otherwise: values like 1700 are NOT a utilization % — leave unmapped
  }
  mapping.traffic = numericByTag("traffic");
  mapping.capacity = numericByTag("capacity");
  mapping.subscribers = numericByTag("subscribers");
  mapping.alarms = numericByTag("alarms");
  mapping.criticalAlarms = numericByTag("critical_alarms");
  mapping.availability = numericByTag("availability");
  mapping.latency = numericByTag("latency");
  mapping.packetLoss = numericByTag("packet_loss");
  mapping.technology = pickBest(profile, "technology", ["categorical"])?.name;
  mapping.vendor = pickBest(profile, "vendor", ["categorical"])?.name;
  mapping.severity = pickBest(profile, "severity", ["categorical"])?.name;

  // Derive utilization from traffic/capacity when absent
  if (!mapping.utilization && mapping.traffic && mapping.capacity) {
    const colName = "Utilization_Pct (derived)";
    for (const r of dataset.rows) {
      const t = toNum(r[mapping.traffic]);
      const c = toNum(r[mapping.capacity]);
      r[colName] = t !== null && c !== null && c > 0 ? Math.min(100, (t / c) * 100) : null;
    }
    if (!dataset.columns.includes(colName)) dataset.columns.push(colName);
    const vals = dataset.rows.map((r) => toNum(r[colName])).filter((x): x is number => x !== null);
    profile.push({
      name: colName,
      role: "numeric",
      semantic: "utilization",
      distinct: 0,
      nullPct: 0,
      samples: [],
      min: Math.min(...vals.slice(0, 20000)),
      max: Math.max(...vals.slice(0, 20000)),
      mean: mean(vals),
      std: std(vals),
      p95: percentile(vals, 95),
    });
    mapping.utilization = colName;
  }

  // Generic-domain anchors
  const measureCols = profile.filter(
    (p) =>
      p.role === "numeric" &&
      !["timestamp", "latitude", "longitude"].includes(p.semantic) &&
      p.name !== mapping.timestamp &&
      p.name !== mapping.latitude &&
      p.name !== mapping.longitude
  );
  mapping.measures = measureCols.map((p) => p.name);
  mapping.primaryMeasure =
    mapping.utilization ??
    profile.find((p) => p.semantic === "revenue" && p.role === "numeric")?.name ??
    mapping.traffic ??
    // prefer "badness" measures (critical/warning/alarm minutes…) over context
    // columns like subscribers when ranking generic datasets
    measureCols
      .filter((p) => p.name !== mapping.subscribers && p.name !== mapping.capacity)
      .sort(
        (a, b) =>
          (measureLooksBad(b.name) ? 1 : 0) - (measureLooksBad(a.name) ? 1 : 0) ||
          (b.std ?? 0) * Math.abs(b.mean ?? 0) - (a.std ?? 0) * Math.abs(a.mean ?? 0)
      )[0]?.name ??
    measureCols[0]?.name;

  mapping.measureHigherIsBad = mapping.primaryMeasure ? measureLooksBad(mapping.primaryMeasure) && mapping.primaryMeasure !== mapping.utilization : false;

  return mapping;
}

/* ---------------- Wide block-structure unpivot (deterministic) ----------- */

/**
 * Detects period-repeated measure blocks by column adjacency:
 *   [identity cols] [date A][measures…] [date B][measures…] [undated measures…]
 * Each date marker owns the first numeric run that follows it. A trailing
 * numeric run of the same size becomes an undated group (newest period + 1).
 * All guards must pass or the table is returned untouched.
 */
function maybeUnpivotBlockColumns(dataset: Dataset): Dataset {
  const cols = dataset.columns;
  const n = dataset.rows.length;
  if (n === 0 || cols.length < 5) return dataset;
  const sample = dataset.rows.slice(0, Math.min(50, n));

  const numericish = (c: string) => {
    let hits = 0;
    let seen = 0;
    for (const r of sample) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      seen++;
      if (toNum(v) !== null && !(typeof v === "string" && /[a-z]{3,}/i.test(v))) hits++;
    }
    return seen > 0 && hits / seen >= 0.9;
  };
  const dateish = (c: string) => {
    if (numericish(c)) return false;
    let hits = 0;
    let seen = 0;
    for (const r of sample) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      seen++;
      if (toEpoch(v) !== null) hits++;
    }
    return seen > 0 && hits / seen >= 0.9;
  };

  const kinds = cols.map((c) => (dateish(c) ? "date" : numericish(c) ? "num" : "other"));
  const markerIdx = kinds.map((k, i) => (k === "date" ? i : -1)).filter((i) => i >= 0);
  if (markerIdx.length < 2) return dataset;

  // marker periods must actually differ
  const markerEpochs = markerIdx.map((i) => toEpoch(dataset.rows[0][cols[i]]));
  if (markerEpochs.some((t) => t === null) || new Set(markerEpochs.map((t) => Math.floor(t! / 3600_000))).size < 2) return dataset;

  // first numeric run after each marker
  const runAfter = (start: number, stop: number): number[] => {
    const run: number[] = [];
    for (let i = start + 1; i < stop; i++) {
      if (kinds[i] === "num") run.push(i);
      else if (run.length > 0) break;
      else if (kinds[i] === "date") break;
    }
    return run;
  };
  const groups: { cols: number[]; markerCol?: string; t?: number }[] = [];
  for (let m = 0; m < markerIdx.length; m++) {
    const stop = m + 1 < markerIdx.length ? markerIdx[m + 1] : cols.length;
    const run = runAfter(markerIdx[m], stop);
    if (run.length === 0) return dataset;
    groups.push({ cols: run, markerCol: cols[markerIdx[m]] });
  }
  const size = groups[0].cols.length;
  if (groups.some((g) => g.cols.length !== size)) return dataset;

  // trailing undated runs after the last marker's run
  const lastUsed = groups[groups.length - 1].cols[size - 1];
  let cursor = lastUsed + 1;
  const sorted = [...markerEpochs].sort((a, b) => (a! < b! ? -1 : 1)) as number[];
  const period = sorted.length >= 2 ? Math.max(1, Math.round((sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) / DAY) ) * DAY : DAY;
  let nextT = Math.max(...(markerEpochs as number[])) + period;
  while (cursor < cols.length) {
    if (kinds[cursor] !== "num") {
      cursor++;
      continue;
    }
    const run: number[] = [];
    while (cursor < cols.length && kinds[cursor] === "num") run.push(cursor++);
    if (run.length === size) {
      groups.push({ cols: run, t: nextT });
      nextT += period;
    }
  }
  if (groups.length < 2) return dataset;

  // aligned columns must share at least one meaningful name token
  const tokens = (c: string) => new Set(c.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((t) => t.length > 2));
  const measureNames: string[] = [];
  for (let i = 0; i < size; i++) {
    const names = groups.map((g) => cols[g.cols[i]]);
    let common: string[] | null = null;
    for (const nm of names) {
      const tk = tokens(nm);
      common = common === null ? [...tk] : common.filter((t) => tk.has(t));
    }
    const shared: string[] = common ?? [];
    if (shared.length === 0) return dataset;
    // preserve original token order using the first name
    const ordered = names[0].toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((t) => shared.includes(t));
    measureNames.push(ordered.join("_") || `measure_${i + 1}`);
  }

  const groupCols = new Set(groups.flatMap((g) => g.cols.map((i) => cols[i])));
  const markerCols = new Set(groups.map((g) => g.markerCol).filter(Boolean) as string[]);
  const keep = cols.filter((c) => !groupCols.has(c) && !markerCols.has(c));

  const rows: Row[] = [];
  for (const r of dataset.rows) {
    for (const g of groups) {
      const t = g.markerCol ? toEpoch(r[g.markerCol]) : (g.t ?? null);
      if (t === null) continue;
      const o: Row = {};
      for (const c of keep) o[c] = r[c];
      o["Timestamp"] = new Date(t).toISOString();
      for (let i = 0; i < size; i++) o[measureNames[i]] = toNum(r[cols[g.cols[i]]]);
      rows.push(o);
    }
    if (rows.length > 240_000) break;
  }
  if (rows.length < n * 2) return dataset;
  return { ...dataset, rows, rowCount: rows.length, columns: Object.keys(rows[0]) };
}

const DAY = 24 * 3600_000;

/* ------------------- Wide date-column unpivot heuristic ------------------ */

/** Columns literally named as dates (PM exports: "2026-05-01", "01/05/2026"…) */
function maybeUnpivotDateColumns(dataset: Dataset): Dataset {
  const dateCols: { name: string; t: number }[] = [];
  for (const c of dataset.columns) {
    const t = toEpoch(c.trim());
    if (t !== null) dateCols.push({ name: c, t });
  }
  if (dateCols.length < 3) return dataset;
  const otherCols = dataset.columns.filter((c) => !dateCols.some((d) => d.name === c));
  const rows: Row[] = [];
  for (const r of dataset.rows) {
    for (const dc of dateCols) {
      const v = toNum(r[dc.name]);
      if (v === null) continue;
      const o: Row = {};
      for (const c of otherCols) o[c] = r[c];
      o["Timestamp (unpivoted)"] = dc.t;
      o["Value"] = v;
      rows.push(o);
    }
    if (rows.length > 240_000) break;
  }
  if (rows.length < dataset.rowCount) return dataset;
  return { ...dataset, rows, rowCount: rows.length, columns: Object.keys(rows[0]) };
}

function maybeUnpivotHourColumns(dataset: Dataset): Dataset {
  const hourCols = dataset.columns.filter((c) => /^h(our)?[_ ]?\d{1,2}$|^\d{1,2}(:00)?$/i.test(c.trim()));
  if (hourCols.length < 6) return dataset;
  const dateCol = dataset.columns.find((c) => /date|day|period/i.test(c));
  if (!dateCol) return dataset;
  const otherCols = dataset.columns.filter((c) => !hourCols.includes(c));
  const rows: Row[] = [];
  for (const r of dataset.rows) {
    const base = toEpoch(r[dateCol]);
    if (base === null) continue;
    for (const hc of hourCols) {
      const hour = parseInt(hc.replace(/\D/g, ""), 10);
      if (Number.isNaN(hour) || hour > 23) continue;
      const v = toNum(r[hc]);
      if (v === null) continue;
      const o: Row = {};
      for (const c of otherCols) o[c] = r[c];
      o["Timestamp (unpivoted)"] = base + hour * 3600_000;
      o["Value"] = v;
      rows.push(o);
    }
    if (rows.length > 240_000) break;
  }
  if (rows.length === 0) return dataset;
  return { ...dataset, rows, rowCount: rows.length, columns: Object.keys(rows[0]) };
}
