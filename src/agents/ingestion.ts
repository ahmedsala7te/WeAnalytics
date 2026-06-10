import Papa from "papaparse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { uid } from "@/lib/format";
import type { CellValue, Dataset, Row } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Agent 1 — Data Ingestion
 * Parses Excel / CSV / JSON / XML / ZIP into a normalized row table.
 * ---------------------------------------------------------------------- */

const MAX_ROWS = 250_000;

export async function ingestFile(file: File): Promise<Dataset> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  let rows: Row[] = [];

  switch (ext) {
    case "csv":
    case "txt":
    case "tsv":
      rows = await parseCsv(await file.text());
      break;
    case "xlsx":
    case "xls":
      rows = parseExcel(await file.arrayBuffer());
      break;
    case "json":
      rows = parseJson(await file.text());
      break;
    case "xml":
      rows = parseXml(await file.text());
      break;
    case "zip":
      rows = await parseZip(await file.arrayBuffer());
      break;
    default:
      throw new Error(`Unsupported file type ".${ext}". Supported: CSV, XLSX, JSON, XML, ZIP.`);
  }

  rows = normalizeRows(rows);
  if (rows.length === 0) throw new Error("No tabular rows could be extracted from this file.");

  return {
    id: uid("ds"),
    name: file.name,
    source: "upload",
    fileType: ext,
    uploadedAt: Date.now(),
    rowCount: rows.length,
    columns: Object.keys(rows[0]),
    rows,
    sizeBytes: file.size,
  };
}

/* ------------------------------- Parsers -------------------------------- */

function parseCsv(text: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => resolve((res.data as Row[]).slice(0, MAX_ROWS)),
      error: (err: Error) => reject(err),
    });
  });
}

function parseExcel(buf: ArrayBuffer): Row[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const rows: Row[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
    for (const r of sheetRows) {
      rows.push(coerceRow(r));
      if (rows.length >= MAX_ROWS) return rows;
    }
    // Most PM exports keep data on the first non-empty sheet
    if (rows.length > 0) break;
  }
  return rows;
}

function parseJson(text: string): Row[] {
  const data = JSON.parse(text);
  const arr = findRecordArray(data);
  if (!arr) throw new Error("JSON file does not contain an array of records.");
  return arr.slice(0, MAX_ROWS).map((r) => coerceRow(flatten(r)));
}

function parseXml(text: string): Row[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: true });
  const doc = parser.parse(text);
  const arr = findRecordArray(doc);
  if (!arr) throw new Error("XML file does not contain a repeating record structure.");
  return arr.slice(0, MAX_ROWS).map((r) => coerceRow(flatten(r)));
}

async function parseZip(buf: ArrayBuffer): Promise<Row[]> {
  const zip = await JSZip.loadAsync(buf);
  const rows: Row[] = [];
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    const ext = entry.name.split(".").pop()?.toLowerCase();
    try {
      if (ext === "csv" || ext === "txt" || ext === "tsv") {
        rows.push(...(await parseCsv(await entry.async("text"))));
      } else if (ext === "xlsx" || ext === "xls") {
        rows.push(...parseExcel(await entry.async("arraybuffer")));
      } else if (ext === "json") {
        rows.push(...parseJson(await entry.async("text")));
      } else if (ext === "xml") {
        rows.push(...parseXml(await entry.async("text")));
      }
    } catch {
      // skip unparseable member files, keep the rest of the archive
    }
    if (rows.length >= MAX_ROWS) break;
  }
  return rows.slice(0, MAX_ROWS);
}

/* ------------------------------- Helpers -------------------------------- */

/** Depth-first search for the largest array of plain objects. */
function findRecordArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 5 || node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    const objs = node.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x));
    if (objs.length >= 1) return objs as Record<string, unknown>[];
    return null;
  }
  if (typeof node === "object") {
    let best: Record<string, unknown>[] | null = null;
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = findRecordArray(v, depth + 1);
      if (found && (!best || found.length > best.length)) best = found;
    }
    return best;
  }
  return null;
}

function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      flatten(v as Record<string, unknown>, key, out);
    } else {
      out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
  }
  return out;
}

function coerceRow(r: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    out[k.trim()] = coerceValue(v);
  }
  return out;
}

function coerceValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Drop fully-empty columns/rows; trim ghost columns from messy exports. */
function normalizeRows(rows: Row[]): Row[] {
  if (rows.length === 0) return rows;
  const cols = Object.keys(rows[0]).filter((c) => c && !c.startsWith("__parsed_extra"));
  const keep = cols.filter((c) => rows.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== ""));
  return rows
    .map((r) => {
      const o: Row = {};
      for (const c of keep) o[c] = r[c] ?? null;
      return o;
    })
    .filter((r) => keep.some((c) => r[c] !== null));
}
