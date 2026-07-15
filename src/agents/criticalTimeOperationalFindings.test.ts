import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt, buildNarrativePrompt, narrativeIsSemanticallySafe } from "@/llm/contextBuilder";
import type { Dataset } from "@/lib/types";
import { buildDataUnderstanding, selectBusinessCase } from "./dataUnderstanding";
import { runPipeline } from "./orchestrator";
import { toEpoch } from "./profiling";

const columns = [
  "msan_code", "sector", "region", "latitude", "longitude", "msan_hostname", "upgrade_status", "subscribers",
  "report_date_yesterday_minus1d", "archive_average_critical_time_yesterday_min", "archive_average_warning_time_yesterday_min", "archive_reason_yesterday",
  "report_date_yesterday_minus2d", "archive_average_critical_time", "archive_average_warning_time", "archive_reason",
  "yesterday_average_critical_time", "yesterday_average_warning_time_min", "yesterday_reason",
];

const values: (string | number)[][] = [
  ["07-4-381-905", "East Delta", "East 2", 0, 0, "DRBNGM", "-", 3452, "2026-05-30T00:00:00.000Z", 743, 762, "msan", "2026-05-29T00:00:00.000Z", 445, 500, "msan", 616, 698, "msan"],
  ["02-1-08-147", "West Cairo", "West 1", 30.12353, 31.27338, "SHKMA147", "New", 1717, "2026-05-30T00:00:00.000Z", 961, 1020, "msan", "2026-05-29T00:00:00.000Z", 938, 998, "msan", 960, 1000, "msan"],
  ["02-3-21-850", "West Cairo", "West 4", 29.75435, 31.28422, "TEBIN", "Cancelled", 3705, "2026-05-30T00:00:00.000Z", 622, 660, "msan", "2026-05-29T00:00:00.000Z", 520, 560, "msan", 436, 665, "msan"],
  ["09-3-18-52", "West Delta", "Beheira 2", 31.16735, 30.06993, "KRDWCB32", "-", 1213, "2026-05-30T00:00:00.000Z", 421, 460, "msan", "2026-05-29T00:00:00.000Z", 336, 459, "msan", 621, 639, "msan"],
  ["10-1-09-01", "Upper Egypt", "Minya", 28.63157, 30.82508, "MGHAGHC1", "New", 229, "2026-05-30T00:00:00.000Z", 559, 640, "msan", "2026-05-29T00:00:00.000Z", 601, 642, "msan", 461, 543, "msan"],
  ["02-3-21-06", "West Cairo", "West 4", 29.8148, 31.30217, "TBNCB18", "New", 1324, "2026-05-30T00:00:00.000Z", 841, 940, "msan", "2026-05-29T00:00:00.000Z", 778, 799, "msan", 839, 860, "msan"],
  ["02-1-01-511", "East Delta", "Qalyubia", 30.18881, 31.1649, "SHLQNC11", "Solved", 1440, "2026-05-30T00:00:00.000Z", 842, 881, "msan", "2026-05-29T00:00:00.000Z", 821, 839, "msan", 779, 841, "msan"],
  ["04-2-82-86", "Giza", "Giza 2", 29.99468, 31.17916, "OMRNIH86", "-", 1014, "2026-05-30T00:00:00.000Z", 739, 840, "msan", "2026-05-29T00:00:00.000Z", 425, 483, "msan", 741, 800, "msan"],
  ["10-3-24-05", "Upper Egypt", "Fayoum", 29.38731, 30.70617, "EBSHC5", "-", 1241, "2026-05-30T00:00:00.000Z", 281, 663, "msan", "2026-05-29T00:00:00.000Z", 383, 442, "msan", 277, 559, "msan"],
  ["02-3-28-125", "West Cairo", "West 3", 29.98517, 31.26301, "MAD2C125", "-", 1360, "2026-05-30T00:00:00.000Z", 321, 418, "msan", "2026-05-29T00:00:00.000Z", 261, 442, "msan", 336, 497, "msan"],
  ["10-1-09-19", "Upper Egypt", "Minya", 28.65294, 30.84632, "MGHAGH19", "-", 908, "2026-05-30T00:00:00.000Z", 562, 722, "msan", "2026-05-29T00:00:00.000Z", 439, 539, "msan", 397, 498, "msan"],
  ["02-3-62-55", "West Cairo", "West 4", 29.87958, 31.2899, "HDYKHC55", "-", 1126, "2026-05-30T00:00:00.000Z", 560, 622, "msan", "2026-05-29T00:00:00.000Z", 298, 393, "msan", 542, 643, "msan"],
  ["10-2-39-951", "Upper Egypt", "Beni Suef", 28.90189, 30.94084, "SODS", "NOT_IN_ULC_PLANS", 1144, "2026-05-30T00:00:00.000Z", 578, 638, "msan", "2026-05-29T00:00:00.000Z", 439, 516, "msan", 644, 723, "msan"],
];

function workbookFixture(): Dataset {
  return {
    id: "critical-msans-6",
    name: "6.xlsx",
    source: "upload",
    fileType: "xlsx",
    sizeBytes: 12778,
    uploadedAt: Date.UTC(2026, 6, 14),
    columns,
    rowCount: values.length,
    rows: values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]))),
  };
}

describe("critical-time operational findings", () => {
  it("preserves explicit ISO dates without the Cairo one-day shift", () => {
    expect(toEpoch("2026-05-30T00:00:00.000Z")).toBe(Date.UTC(2026, 4, 30));
  });

  it("uses network means, material exceptions, and evidence-safe storytelling", async () => {
    const initial = buildDataUnderstanding(workbookFixture());
    const understanding = selectBusinessCase(initial, "critical_time_comparison");
    expect(understanding.dataset.rowCount).toBe(39);

    const analysis = await runPipeline(workbookFixture(), { understanding });
    const critical = analysis.kpis.find((k) => k.name === "Average Critical Time / MSAN");
    const warning = analysis.kpis.find((k) => k.name === "Average Warning Time / MSAN");
    const worsening = analysis.kpis.find((k) => k.name === "Worsening MSANs");
    const impacted = analysis.kpis.find((k) => k.name === "Subscribers on Worsening MSANs");

    expect(analysis.timeRange?.start).toBe(Date.UTC(2026, 4, 29));
    expect(analysis.timeRange?.end).toBe(Date.UTC(2026, 4, 31));
    expect(critical?.value).toBeCloseTo(588.3846, 3);
    expect(critical?.previous).toBeCloseTo(617.6923, 3);
    expect(critical?.changePct).toBeCloseTo(-4.7447, 3);
    expect(warning?.value).toBeCloseTo(689.6923, 3);
    expect(worsening?.value).toBe(3);
    expect(impacted?.value).toBe(3717);
    expect(analysis.topEntityDaily).toHaveLength(13);
    expect(analysis.kpis.some((k) => /critical.*per subscriber|per subscriber.*critical/i.test(k.name))).toBe(false);
    expect(analysis.story.headline).toContain("3 of 13 MSANs");
    expect(analysis.story.headline).toContain("3717 subscribers");
    expect(analysis.story.summary).toContain("not a sum of averages");
    expect(analysis.story.summary).toContain("not a per-subscriber duration");
    expect(analysis.story.keyInsights.join(" ")).toContain("09-3-18-52");

    const prompt = buildNarrativePrompt(analysis);
    expect(prompt.user).toContain("NEVER divide critical/warning time by subscribers");
    expect(buildChatSystemPrompt(analysis)).toContain("Never sum row averages");
    expect(narrativeIsSemanticallySafe(analysis, {
      headline: "Critical time update",
      summary: "Average critical time per subscriber is 0.4.",
    })).toBe(false);
  });
});
