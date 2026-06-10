import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import PptxGenJS from "pptxgenjs";
import { fmtDate, fmtDateTime, fmtKpiValue, fmtNum, fmtPct, downloadBlob } from "@/lib/format";
import { healthLabel } from "@/lib/constants";
import { snapshotCharts } from "@/lib/chartRegistry";
import type { AnalysisResult } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Agent 11 — Report Generation
 * Executive PDF, PowerPoint deck, Excel workbook and CSV extracts.
 * ---------------------------------------------------------------------- */

const stamp = () => new Date().toISOString().slice(0, 10);

/* --------------------------------- CSV ---------------------------------- */

export function exportKpiCsv(a: AnalysisResult) {
  const lines = ["KPI,Value,Unit,Change %,Status,Category"];
  for (const k of a.kpis) {
    lines.push(
      [csvCell(k.name), k.value.toFixed(2), csvCell(k.unit), k.changePct === null ? "" : k.changePct.toFixed(1), k.status, k.category].join(",")
    );
  }
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `netpulse-kpis-${stamp()}.csv`);
}

export function exportCongestionCsv(a: AnalysisResult) {
  const lines = ["Entity,Region,Time,Utilization %,Severity"];
  for (const e of a.congestionEvents.slice(0, 50_000)) {
    lines.push([csvCell(e.entity), csvCell(e.region), fmtDateTime(e.time), e.utilization.toFixed(1), e.severity].join(","));
  }
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `netpulse-congestion-events-${stamp()}.csv`);
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* --------------------------------- XLSX --------------------------------- */

export function exportXlsx(a: AnalysisResult) {
  const wb = XLSX.utils.book_new();

  const kpiSheet = XLSX.utils.json_to_sheet(
    a.kpis.map((k) => ({
      KPI: k.name,
      Value: Number(k.value.toFixed(2)),
      Unit: k.unit,
      "Change %": k.changePct === null ? "" : Number(k.changePct.toFixed(1)),
      Status: k.status,
      Category: k.category,
      Formula: k.formula,
    }))
  );
  XLSX.utils.book_append_sheet(wb, kpiSheet, "KPIs");

  if (a.regionStats.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.regionStats.map((r) => ({
          Region: r.region,
          "Health Score": Number(r.healthScore.toFixed(1)),
          "Risk Score": Number(r.riskScore.toFixed(1)),
          Elements: r.entities,
          "Avg Util %": Number(r.avgUtil.toFixed(1)),
          "Peak Util %": Number(r.peakUtil.toFixed(1)),
          "Congested Elements": r.congestedEntities,
          "Chronic Elements": r.chronicEntities,
          "Congestion Events": r.congestionEvents,
          Alarms: r.alarmCount,
          "Critical Alarms": r.criticalAlarms,
          "Availability %": r.availability === null ? "" : Number(r.availability.toFixed(2)),
          "Growth %/wk": Number(r.growthPctPerWeek.toFixed(2)),
          "Subscribers Impacted": r.subscribersImpacted,
        }))
      ),
      "Regions"
    );
  }

  if (a.entityStats.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.entityStats.slice(0, 2000).map((e) => ({
          Element: e.entity,
          Region: e.region,
          "Risk Score": Number(e.riskScore.toFixed(1)),
          "Avg Util %": Number(e.avgUtil.toFixed(1)),
          "p95 Util %": Number(e.p95Util.toFixed(1)),
          "Peak Util %": Number(e.peakUtil.toFixed(1)),
          "Congested Hours": e.congestedHours,
          "Congested Days": e.congestedDays,
          Chronic: e.chronic ? "YES" : "",
          "Growth %/wk": Number(e.growthPctPerWeek.toFixed(2)),
          "Saturation Date": e.saturationDate ? fmtDate(e.saturationDate) : "",
          Subscribers: e.subscribers ?? "",
          Alarms: e.alarmCount,
        }))
      ),
      "Elements"
    );
  }

  if (a.congestionEvents.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.congestionEvents.slice(0, 10_000).map((e) => ({
          Element: e.entity,
          Region: e.region,
          Time: fmtDateTime(e.time),
          "Utilization %": Number(e.utilization.toFixed(1)),
          Severity: e.severity,
        }))
      ),
      "Congestion Events"
    );
  }

  if (a.anomalies.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.anomalies.map((an) => ({
          Time: fmtDateTime(an.time),
          Kind: an.kind,
          Metric: an.metric,
          Region: an.region ?? "",
          Value: Number(an.value.toFixed(1)),
          Expected: Number(an.expected.toFixed(1)),
          Severity: an.severity,
          Description: an.text,
        }))
      ),
      "Anomalies"
    );
  }

  const insightsSheet = XLSX.utils.json_to_sheet([
    { Section: "Headline", Text: a.story.headline },
    { Section: "Summary", Text: a.story.summary },
    ...a.story.keyInsights.map((t) => ({ Section: "Key insight", Text: t })),
    ...a.story.risks.map((t) => ({ Section: "Risk", Text: t })),
    ...a.story.recommendations.map((t) => ({ Section: "Recommendation", Text: t })),
  ]);
  XLSX.utils.book_append_sheet(wb, insightsSheet, "AI Narrative");

  XLSX.writeFile(wb, `netpulse-analysis-${stamp()}.xlsx`);
}

/* ---------------------------------- PDF ---------------------------------- */

export function exportPdf(a: AnalysisResult, isDark: boolean) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;
  const M = 16;
  const navy = "#0f172a";
  const slate = "#475569";
  const blue = "#3b82f6";

  /* Cover */
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, H, "F");
  doc.setTextColor(59, 130, 246);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("NETPULSE — NETWORK INTELLIGENCE HUB", M, 38);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(30);
  doc.text("Executive Network Report", M, 58);
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(`Dataset: ${a.datasetName}`, M, 74);
  doc.text(`Generated: ${fmtDate(Date.now())} · ${fmtNum(a.rowsAnalyzed, 0)} rows analyzed · Domain: ${a.domains[0]?.domain ?? "—"} (${a.domains[0]?.confidence ?? 0}%)`, M, 82);
  if (a.timeRange) doc.text(`Window: ${fmtDate(a.timeRange.start)} → ${fmtDate(a.timeRange.end)} (${a.timeRange.days} days)`, M, 90);

  doc.setFontSize(64);
  doc.setFont("helvetica", "bold");
  const hc: [number, number, number] = a.healthScore >= 75 ? [16, 185, 129] : a.healthScore >= 60 ? [245, 158, 11] : [239, 68, 68];
  doc.setTextColor(hc[0], hc[1], hc[2]);
  doc.text(a.healthScore.toFixed(1), W - M - 70, 70);
  doc.setFontSize(12);
  doc.setTextColor(148, 163, 184);
  doc.text(`NETWORK HEALTH · ${healthLabel(a.healthScore).toUpperCase()}`, W - M - 70, 80);

  doc.setFontSize(12);
  doc.setTextColor(226, 232, 240);
  const headlineLines = doc.splitTextToSize(a.story.headline, W - 2 * M);
  doc.text(headlineLines, M, 120);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(10.5);
  const summaryLines = doc.splitTextToSize(a.story.summary, W - 2 * M);
  doc.text(summaryLines, M, 134);

  /* KPI page */
  doc.addPage();
  pageHeader(doc, "Discovered KPIs", navy, slate);
  let y = 34;
  const colW = (W - 2 * M) / 3;
  a.kpis.slice(0, 12).forEach((k, i) => {
    const cx = M + (i % 3) * colW;
    if (i % 3 === 0 && i > 0) y += 38;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(cx, y, colW - 6, 32, 2.5, 2.5, "FD");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.text(k.name.toUpperCase(), cx + 5, y + 8);
    doc.setFontSize(17);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(fmtKpiValue(k.value, k.unit), cx + 5, y + 19);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const statusColor = k.status === "healthy" ? [16, 185, 129] : k.status === "watch" ? [6, 182, 212] : k.status === "warning" ? [245, 158, 11] : [239, 68, 68];
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.text(
      `${k.status.toUpperCase()}${k.changePct !== null ? `  ·  ${k.changePct > 0 ? "+" : ""}${k.changePct.toFixed(1)}% vs prior` : ""}`,
      cx + 5,
      y + 27
    );
  });

  /* Charts */
  const shots = snapshotCharts(6, isDark);
  for (let i = 0; i < shots.length; i += 2) {
    doc.addPage();
    pageHeader(doc, "Dashboard Visuals", navy, slate);
    const slots = shots.slice(i, i + 2);
    slots.forEach((s, j) => {
      const maxW = (W - 2 * M - 10) / 2;
      const ratio = Math.min(maxW / s.width, 130 / s.height);
      const iw = s.width * ratio;
      const ih = s.height * ratio;
      const x = M + j * (maxW + 10);
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(s.title, x, 36);
      try {
        doc.addImage(s.dataUrl, "PNG", x, 42, iw, ih);
      } catch {
        /* skip broken snapshot */
      }
    });
  }

  /* Insights & recommendations */
  doc.addPage();
  pageHeader(doc, "AI Insights, Risks & Recommendations", navy, slate);
  y = 36;
  const writeSection = (title: string, items: string[], color: [number, number, number]) => {
    if (!items.length) return;
    doc.setFontSize(12.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(title, M, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    for (const it of items) {
      const lines = doc.splitTextToSize(`•  ${it}`, W - 2 * M);
      if (y + lines.length * 5 > H - 14) {
        doc.addPage();
        pageHeader(doc, "AI Insights (continued)", navy, slate);
        y = 36;
      }
      doc.text(lines, M, y);
      y += lines.length * 5 + 2.5;
    }
    y += 4;
  };
  writeSection("Key Findings", a.story.keyInsights, [59, 130, 246]);
  writeSection("Root Causes", a.story.rootCauses, [245, 158, 11]);
  writeSection("Risks", a.story.risks, [239, 68, 68]);
  writeSection("Recommendations", a.story.recommendations, [16, 185, 129]);

  void blue;
  doc.save(`netpulse-executive-report-${stamp()}.pdf`);
}

function pageHeader(doc: jsPDF, title: string, navy: string, slate: string) {
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, 297, 24, "F");
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(title, 16, 15);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`NetPulse · ${fmtDate(Date.now())}`, 297 - 16, 15, { align: "right" });
  void navy;
  void slate;
}

/* --------------------------------- PPTX ---------------------------------- */

export async function exportPptx(a: AnalysisResult, isDark: boolean) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  const NAVY = "0F172A";
  const BLUE = "3B82F6";
  const SLATE = "94A3B8";
  const GREEN = "10B981";
  const AMBER = "F59E0B";
  const RED = "EF4444";

  /* Title slide */
  let slide = pptx.addSlide();
  slide.background = { color: NAVY };
  slide.addText("NetPulse — Network Intelligence Hub", { x: 0.6, y: 0.7, w: 9, h: 0.5, fontSize: 16, color: BLUE, bold: true });
  slide.addText("Executive Network Report", { x: 0.6, y: 1.4, w: 11, h: 1.1, fontSize: 40, color: "FFFFFF", bold: true });
  slide.addText(
    [
      { text: `Dataset: ${a.datasetName}\n`, options: { color: SLATE, fontSize: 14 } },
      { text: `${fmtNum(a.rowsAnalyzed, 0)} rows · ${a.domains[0]?.domain} (${a.domains[0]?.confidence}%)${a.timeRange ? ` · ${fmtDate(a.timeRange.start)} → ${fmtDate(a.timeRange.end)}` : ""}\n`, options: { color: SLATE, fontSize: 14 } },
      { text: `Generated ${fmtDate(Date.now())} by the AI analysis pipeline`, options: { color: SLATE, fontSize: 14 } },
    ],
    { x: 0.6, y: 2.7, w: 11, h: 1.4 }
  );
  const healthColor = a.healthScore >= 75 ? GREEN : a.healthScore >= 60 ? AMBER : RED;
  slide.addText(a.healthScore.toFixed(1), { x: 9.4, y: 4.4, w: 3.4, h: 1.6, fontSize: 72, bold: true, color: healthColor, align: "right" });
  slide.addText(`NETWORK HEALTH · ${healthLabel(a.healthScore).toUpperCase()}`, { x: 7.4, y: 6.0, w: 5.4, h: 0.4, fontSize: 13, color: SLATE, align: "right" });
  slide.addText(a.story.headline, { x: 0.6, y: 4.6, w: 8.2, h: 1.8, fontSize: 17, color: "E2E8F0" });

  /* KPI slide */
  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  slide.addText("Discovered KPIs", { x: 0.6, y: 0.4, w: 8, h: 0.6, fontSize: 24, bold: true, color: NAVY });
  a.kpis.slice(0, 8).forEach((k, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.6 + col * 3.12;
    const y = 1.4 + row * 2.6;
    slide.addShape("roundRect", { x, y, w: 2.9, h: 2.3, fill: { color: "FFFFFF" }, line: { color: "E2E8F0", width: 1 }, rectRadius: 0.08 });
    slide.addText(k.name.toUpperCase(), { x: x + 0.15, y: y + 0.15, w: 2.6, h: 0.5, fontSize: 10, color: "64748B", bold: true });
    slide.addText(fmtKpiValue(k.value, k.unit), { x: x + 0.15, y: y + 0.7, w: 2.6, h: 0.7, fontSize: 26, bold: true, color: NAVY });
    const sc = k.status === "healthy" ? GREEN : k.status === "watch" ? "06B6D4" : k.status === "warning" ? AMBER : RED;
    slide.addText(`${k.status.toUpperCase()}${k.changePct !== null ? ` · ${k.changePct > 0 ? "+" : ""}${k.changePct.toFixed(1)}%` : ""}`, {
      x: x + 0.15,
      y: y + 1.6,
      w: 2.6,
      h: 0.4,
      fontSize: 11,
      color: sc,
      bold: true,
    });
  });

  /* Chart slides */
  const shots = snapshotCharts(4, isDark);
  for (const s of shots) {
    const cs = pptx.addSlide();
    cs.background = { color: "F8FAFC" };
    cs.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 22, bold: true, color: NAVY });
    const maxW = 12.1;
    const maxH = 5.9;
    const ratio = Math.min(maxW / s.width, maxH / s.height);
    cs.addImage({ data: s.dataUrl, x: 0.6, y: 1.2, w: s.width * ratio, h: s.height * ratio });
  }

  /* Recommendations slide */
  slide = pptx.addSlide();
  slide.background = { color: NAVY };
  slide.addText("Risks & Recommendations", { x: 0.6, y: 0.4, w: 10, h: 0.6, fontSize: 24, bold: true, color: "FFFFFF" });
  slide.addText("RISKS", { x: 0.6, y: 1.3, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: RED });
  slide.addText(a.story.risks.slice(0, 4).map((r) => ({ text: r, options: { bullet: true, color: "CBD5E1", fontSize: 13, breakLine: true } })), {
    x: 0.6,
    y: 1.8,
    w: 5.8,
    h: 4.6,
    valign: "top",
  });
  slide.addText("RECOMMENDATIONS", { x: 6.9, y: 1.3, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: GREEN });
  slide.addText(a.story.recommendations.slice(0, 5).map((r) => ({ text: r, options: { bullet: true, color: "CBD5E1", fontSize: 13, breakLine: true } })), {
    x: 6.9,
    y: 1.8,
    w: 5.8,
    h: 4.6,
    valign: "top",
  });

  await pptx.writeFile({ fileName: `netpulse-executive-deck-${stamp()}.pptx` });
}
