import { detectDomains } from "./domainDetection";
import { profileDataset } from "./profiling";
import { detectTelecomBusinessContext, getTelecomBusinessCaseLabel } from "./telecomBusinessCases";
import type { ColumnProfile, DataUnderstandingReport, DataUnderstandingWarning, Dataset, SemanticMapping, TelecomBusinessCaseId } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Data Understanding review — a lightweight pre-analysis pass.
 * It packages the profiler/domain output into a user-visible trust report.
 * ---------------------------------------------------------------------- */

export function buildDataUnderstanding(dataset: Dataset): DataUnderstandingReport {
  const profiled = profileDataset(dataset);
  const domains = detectDomains(profiled.profile, profiled.mapping);
  return buildReport(profiled.dataset, profiled.profile, profiled.mapping, domains, dataset);
}

export function buildUnderstandingDigest(report: DataUnderstandingReport): string {
  const mapping = report.mapping;
  const topColumns = report.profile
    .slice()
    .sort((a, b) => roleRank(b.role) - roleRank(a.role) || a.nullPct - b.nullPct)
    .slice(0, 28)
    .map((p) => {
      const stats =
        p.role === "numeric"
          ? `min=${fmt(p.min)} max=${fmt(p.max)} mean=${fmt(p.mean)}`
          : `distinct=${p.distinct}`;
      return `- ${p.name}: role=${p.role}, semantic=${p.semantic}, null=${Math.round(p.nullPct)}%, ${stats}, samples=${p.samples.slice(0, 3).join(" | ")}`;
    });
  return [
    `DATASET: ${report.dataset.name}`,
    `ROWS: ${report.quality.rows}`,
    `COLUMNS: ${report.quality.columns}`,
    `DOMAIN MATCHES: ${report.domains.map((d) => `${d.domain} ${d.confidence}%`).join(", ")}`,
    `DETECTED MAPPING: timestamp=${mapping.timestamp ?? "none"}; entity=${mapping.entity ?? "none"}; region=${mapping.region ?? "none"}; primaryMeasure=${mapping.primaryMeasure ?? "none"}; utilization=${mapping.utilization ?? "none"}; traffic=${mapping.traffic ?? "none"}; capacity=${mapping.capacity ?? "none"}; subscribers=${mapping.subscribers ?? "none"}; alarms=${mapping.alarms ?? "none"}`,
    `BUSINESS CASE: ${report.businessContext.selectedLabel} (${report.businessContext.selectedCaseId}); candidates=${report.businessContext.candidates.map((c) => `${c.label} ${c.score}%`).join(", ")}`,
    `QUALITY: numeric=${report.quality.numericColumns}; datetime=${report.quality.datetimeColumns}; categorical=${report.quality.categoricalColumns}; identifiers=${report.quality.identifierColumns}; avgNull=${report.quality.averageNullPct.toFixed(1)}%`,
    report.transformNote ? `TRANSFORM: ${report.transformNote}` : "TRANSFORM: none",
    `WARNINGS: ${report.warnings.map((w) => `${w.severity}: ${w.message}`).join(" | ") || "none"}`,
    `COLUMN INVENTORY:\n${topColumns.join("\n")}`,
  ].join("\n");
}

export function updateUnderstandingMapping(
  report: DataUnderstandingReport,
  mapping: SemanticMapping
): DataUnderstandingReport {
  const next = buildReport(report.dataset, report.profile, mapping, detectDomains(report.profile, mapping), report.dataset, report.transformNote);
  return { ...next, transformed: report.transformed, transformNote: report.transformNote };
}

export function selectBusinessCase(report: DataUnderstandingReport, id: TelecomBusinessCaseId): DataUnderstandingReport {
  return {
    ...report,
    businessContext: {
      ...report.businessContext,
      selectedCaseId: id,
      selectedLabel: getTelecomBusinessCaseLabel(id),
    },
  };
}

function buildReport(
  dataset: Dataset,
  profile: ColumnProfile[],
  mapping: SemanticMapping,
  domains: DataUnderstandingReport["domains"],
  original: Dataset,
  note?: string
): DataUnderstandingReport {
  const numericColumns = profile.filter((p) => p.role === "numeric").length;
  const datetimeColumns = profile.filter((p) => p.role === "datetime").length;
  const categoricalColumns = profile.filter((p) => p.role === "categorical").length;
  const identifierColumns = profile.filter((p) => p.role === "identifier").length;
  const averageNullPct = profile.length ? profile.reduce((s, p) => s + p.nullPct, 0) / profile.length : 0;
  const transformed = dataset.rowCount !== original.rowCount || dataset.columns.length !== original.columns.length;
  const businessContext = detectTelecomBusinessContext(dataset, profile, mapping);
  const transformNote =
    note ??
    (transformed
      ? `The profiler reshaped the file into ${dataset.rowCount.toLocaleString()} analysis rows and ${dataset.columns.length} columns.`
      : undefined);

  return {
    dataset,
    profile,
    domains,
    mapping,
    businessContext,
    warnings: buildWarnings(dataset, profile, mapping, domains, transformed),
    transformed,
    transformNote,
    quality: {
      rows: dataset.rowCount,
      columns: dataset.columns.length,
      numericColumns,
      datetimeColumns,
      categoricalColumns,
      identifierColumns,
      averageNullPct,
    },
  };
}

function buildWarnings(
  dataset: Dataset,
  profile: ColumnProfile[],
  mapping: SemanticMapping,
  domains: DataUnderstandingReport["domains"],
  transformed: boolean
): DataUnderstandingWarning[] {
  const warnings: DataUnderstandingWarning[] = [];
  const top = domains[0];
  if (!top || top.confidence < 55) {
    warnings.push({
      severity: "warning",
      message: "The domain match is weak. Add a prompt that explains the business goal so the LLM can choose a better dashboard.",
    });
  }
  if (!mapping.primaryMeasure) {
    warnings.push({
      severity: "critical",
      message: "No primary numeric measure was detected. The dashboard may be limited unless the LLM can identify a useful focus from the columns.",
    });
  }
  if (!mapping.entity && !mapping.region) {
    warnings.push({
      severity: "warning",
      message: "No breakdown dimension was detected. The dashboard may be limited to totals and distributions.",
    });
  }
  if (!mapping.timestamp) {
    warnings.push({
      severity: "info",
      message: "No timestamp column was detected, so trend and forecast widgets will be limited.",
    });
  }
  if (dataset.rowCount >= 240_000) {
    warnings.push({
      severity: "warning",
      message: "The dataset is near the in-browser row limit. Some very large uploads may be truncated before analysis.",
    });
  }
  const highNullCols = profile.filter((p) => p.nullPct >= 60);
  if (highNullCols.length > 0) {
    warnings.push({
      severity: "info",
      message: `${highNullCols.length} column(s) have more than 60% empty values and may be ignored by the analysis.`,
    });
  }
  if (transformed) {
    warnings.push({
      severity: "info",
      message: "The profiler reshaped a wide export into a long analysis table before dashboard generation.",
    });
  }
  const business = detectTelecomBusinessContext(dataset, profile, mapping).candidates[0];
  if (business) {
    warnings.push({
      severity: "info",
      message: `Detected telecom business case: ${getTelecomBusinessCaseLabel(business.id)} (${business.score}% match).`,
    });
  }
  return warnings;
}

function roleRank(role: ColumnProfile["role"]): number {
  switch (role) {
    case "numeric":
      return 5;
    case "datetime":
      return 4;
    case "categorical":
      return 3;
    case "identifier":
      return 2;
    default:
      return 1;
  }
}

function fmt(x?: number): string {
  if (x === undefined || Number.isNaN(x)) return "?";
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
}
