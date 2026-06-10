import { fmtDate, fmtNum, fmtPct, fmtSigned } from "@/lib/format";
import { healthLabel, THRESHOLDS } from "@/lib/constants";
import type { AnalysisResult, ChatChart } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Agent 12 — AI Chat Assistant
 * Deterministic NL understanding over the computed analysis artifacts.
 * Every answer is grounded in the uploaded dataset — no hallucination.
 * ---------------------------------------------------------------------- */

export interface AssistantAnswer {
  text: string;
  chart?: ChatChart;
  action?: "export-pdf" | "export-pptx" | "export-xlsx";
}

export function answerQuery(q: string, a: AnalysisResult): AssistantAnswer {
  const query = q.toLowerCase().trim();

  /* --------------------------- report generation -------------------------- */
  if (/(generate|create|export|build|prepare).*(report|pdf|deck|presentation|pptx|excel)/.test(query) || /^(cto |executive )?report$/.test(query)) {
    const wantPptx = /pptx|powerpoint|deck|presentation|slides/.test(query);
    const wantXlsx = /excel|xlsx|sheet/.test(query);
    const action = wantPptx ? "export-pptx" : wantXlsx ? "export-xlsx" : "export-pdf";
    return {
      text: `Generating the ${wantPptx ? "PowerPoint deck" : wantXlsx ? "Excel workbook" : "executive PDF report"} for “${a.datasetName}” now — it includes the health summary, discovered KPIs, top risks and the AI recommendations. The download starts automatically.`,
      action,
    };
  }

  /* ------------------------------- top N lists ----------------------------- */
  const topMatch = query.match(/top\s*(\d+)?\s*(congest|risk|utiliz|alarm|growth|grow|saturat)/);
  if (topMatch || /show.*(congested|critical).*(links|elements|msans|sites)/.test(query)) {
    const n = Math.min(20, parseInt(topMatch?.[1] ?? "10", 10) || 10);
    const what = topMatch?.[2] ?? "congest";
    let items: { name: string; value: number }[] = [];
    let label = "";
    let unit = "";
    if (/alarm/.test(what)) {
      items = [...a.entityStats].sort((x, y) => y.alarmCount - x.alarmCount).slice(0, n).map((e) => ({ name: e.entity, value: e.alarmCount }));
      label = `Top ${items.length} elements by alarm volume`;
      unit = "alarms";
    } else if (/risk/.test(what)) {
      items = a.entityStats.slice(0, n).map((e) => ({ name: e.entity, value: Math.round(e.riskScore) }));
      label = `Top ${items.length} elements by capacity risk score`;
      unit = "score";
    } else if (/grow/.test(what) || /saturat/.test(what)) {
      items = [...a.entityStats].sort((x, y) => y.growthPctPerWeek - x.growthPctPerWeek).slice(0, n).map((e) => ({ name: e.entity, value: Math.round(e.growthPctPerWeek * 10) / 10 }));
      label = `Top ${items.length} elements by weekly growth`;
      unit = "%/wk";
    } else if (/utiliz/.test(what)) {
      items = [...a.entityStats].sort((x, y) => y.p95Util - x.p95Util).slice(0, n).map((e) => ({ name: e.entity, value: Math.round(e.p95Util * 10) / 10 }));
      label = `Top ${items.length} elements by p95 utilization`;
      unit = "%";
    } else {
      items = [...a.entityStats].sort((x, y) => y.congestedHours - x.congestedHours).slice(0, n).filter((e) => true).map((e) => ({ name: e.entity, value: e.congestedHours }));
      label = `Top ${items.length} congested elements (congested hours)`;
      unit = "hours ≥90%";
    }
    items = items.filter((i) => i.value > 0);
    if (items.length === 0) return { text: "No matching elements found — nothing in the current dataset exceeds the relevant thresholds. That's good news." };
    const lines = items.slice(0, 5).map((i, idx) => `${idx + 1}. ${i.name} — ${fmtNum(i.value)} ${unit}`).join("\n");
    return {
      text: `**${label}**\n${lines}${items.length > 5 ? `\n…and ${items.length - 5} more in the chart.` : ""}`,
      chart: { kind: "bar", name: label, labels: items.map((i) => i.name), values: items.map((i) => i.value), unit },
    };
  }

  /* ------------------------- why congestion / RCA -------------------------- */
  if (/(why|cause|reason|explain).*(congest|degrad|slow)/.test(query) || /root\s*cause/.test(query)) {
    const rc = a.rootCauses.find((r) => r.scope === "Congestion") ?? a.rootCauses[0];
    if (!rc) {
      return {
        text: a.congestionEvents.length === 0
          ? "No congestion was detected in this dataset, so there is no congestion root cause to explain. The network operated below the 90% threshold throughout the window."
          : "Congestion exists but is too diffuse for a confident causal chain. Check the Performance dashboard's Pareto chart to see how events distribute across elements.",
      };
    }
    return {
      text: `**What happened:** ${rc.what}\n\n**Why:** ${rc.why}\n\n**Most affected:** ${rc.affected.slice(0, 5).join("; ")}\n\n**Impact:** ${rc.impact}\n\n**Recommended actions:**\n${rc.actions.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n_Confidence: ${Math.round(rc.confidence * 100)}%_`,
    };
  }

  /* -------------------------- worst / most affected ------------------------ */
  if (/(which|what|most|worst).*(region|area|zone|governorate)/.test(query) || /most affected/.test(query)) {
    if (a.regionStats.length === 0) return { text: "This dataset has no region dimension I could detect, so regional ranking is unavailable." };
    const ranked = [...a.regionStats].sort((x, y) => y.riskScore - x.riskScore);
    const top = ranked[0];
    const lines = ranked.slice(0, 5).map((r, i) => `${i + 1}. ${r.region} — health ${r.healthScore.toFixed(0)}/100, ${r.congestionEvents} congestion events, ${r.chronicEntities} chronic`).join("\n");
    return {
      text: `**${top.region}** is the most affected region: health score ${top.healthScore.toFixed(0)}/100, ${top.congestedEntities}/${top.entities} elements congested, demand growing ${fmtPct(top.growthPctPerWeek, 1)}/week${top.subscribersImpacted ? `, ≈${fmtNum(top.subscribersImpacted, 0)} subscribers impacted` : ""}.\n\n**Regional ranking:**\n${lines}`,
      chart: { kind: "bar", name: "Region risk score", labels: ranked.slice(0, 8).map((r) => r.region), values: ranked.slice(0, 8).map((r) => Math.round(r.riskScore)), unit: "risk" },
    };
  }

  /* ----------------------------- forecast intent --------------------------- */
  if (/(predict|forecast|next (month|week)|will|project|saturat|exhaust)/.test(query)) {
    const fc = a.forecasts.find((f) => f.name.toLowerCase().includes("peak")) ?? a.forecasts[0];
    if (!fc) return { text: "Forecasting needs a time dimension with at least ~5 days of history, which this dataset doesn't provide." };
    const last = fc.history[fc.history.length - 1];
    const endFc = fc.forecast[fc.forecast.length - 1];
    const satText = fc.saturationDate
      ? `At the current trajectory it crosses ${fc.saturationThreshold}% around **${fmtDate(fc.saturationDate)}**.`
      : `No saturation crossing is projected within the forecast horizon.`;
    const saturating = a.entityStats.filter((e) => e.saturationDate !== null && e.saturationDate <= Date.now() + 60 * 24 * 3600_000);
    const histTail = fc.history.slice(-14);
    return {
      text: `**${fc.name}** is currently ${fmtNum(last.v)}${fc.unit === "%" ? "%" : ` ${fc.unit}`} and is projected to reach ${fmtNum(endFc.v)}${fc.unit === "%" ? "%" : ` ${fc.unit}`} in ${fc.forecast.length} days (${fmtSigned(((endFc.v - last.v) / Math.max(1e-9, last.v)) * 100, 1)}). ${satText}${
        saturating.length ? `\n\n${saturating.length} individual elements saturate within 60 days — see Capacity Planning → Expansion Priorities.` : ""
      }\n\n_Method: ${fc.method}_`,
      chart: {
        kind: "line",
        name: fc.name,
        labels: [...histTail.map((p) => fmtDate(p.t).slice(0, 6)), ...fc.forecast.map((p) => fmtDate(p.t).slice(0, 6))],
        values: [...histTail.map((p) => Math.round(p.v * 10) / 10), ...fc.forecast.map((p) => Math.round(p.v * 10) / 10)],
        unit: fc.unit,
      },
    };
  }

  /* ----------------------------- alarms intent ----------------------------- */
  if (/alarm|storm|trap|fault/.test(query)) {
    const storm = a.anomalies.find((x) => x.kind === "alarm_storm");
    const alarmKpi = a.kpis.find((k) => k.name === "Alarm Volume");
    const rc = a.rootCauses.find((r) => r.scope === "Alarm storm");
    if (!alarmKpi && !storm) return { text: "No alarm columns were detected in this dataset, so alarm analytics are unavailable." };
    let text = "";
    if (alarmKpi) text += `Alarm volume over the trailing week: **${fmtNum(alarmKpi.value, 0)}**${alarmKpi.changePct !== null ? ` (${fmtSigned(alarmKpi.changePct, 0)} vs prior week)` : ""}.\n\n`;
    if (storm) text += `${storm.text}.\n\n`;
    if (rc) text += `**Likely cause:** ${rc.why}\n\n**Actions:** ${rc.actions[0]}`;
    if (!storm && !rc) text += "No alarm storms detected — alarm activity is within its normal baseline.";
    return { text: text.trim() };
  }

  /* ------------------------------ health intent ---------------------------- */
  if (/health|score|overall|status|summary/.test(query)) {
    const regions = [...a.regionStats].sort((x, y) => x.healthScore - y.healthScore);
    return {
      text: `**Network Health Score: ${a.healthScore.toFixed(1)}/100 (${healthLabel(a.healthScore)})**\n\n${a.story.headline}\n\n${a.story.summary}${
        regions.length ? `\n\nWeakest regions: ${regions.slice(0, 3).map((r) => `${r.region} (${r.healthScore.toFixed(0)})`).join(", ")}.` : ""
      }`,
      chart: regions.length
        ? { kind: "bar", name: "Regional health scores", labels: regions.slice(0, 10).map((r) => r.region), values: regions.slice(0, 10).map((r) => Math.round(r.healthScore)), unit: "/100" }
        : undefined,
    };
  }

  /* ---------------------------- busy hour intent --------------------------- */
  if (/busy\s*hour|peak\s*hour|when.*peak/.test(query)) {
    if (a.busyHourProfile.length !== 24) return { text: "This dataset doesn't have hourly granularity, so a busy-hour profile can't be derived." };
    const profile = a.busyHourProfile.map((v) => v ?? 0);
    const busiest = profile.indexOf(Math.max(...profile));
    return {
      text: `The network busy hour is **${String(busiest).padStart(2, "0")}:00**, averaging ${fmtPct(profile[busiest], 1)} utilization. Evening hours (19:00–23:00) carry the heaviest load — capacity decisions should be sized on this window, not daily averages.`,
      chart: { kind: "line", name: "24-hour utilization profile", labels: profile.map((_, h) => `${String(h).padStart(2, "0")}:00`), values: profile.map((v) => Math.round(v * 10) / 10), unit: "%" },
    };
  }

  /* ----------------------------- explain KPI ------------------------------- */
  if (/(explain|how|what is|define|meaning|calculat)/.test(query)) {
    const hit = a.kpis.find((k) => query.includes(k.name.toLowerCase())) ??
      a.kpis.find((k) => k.name.toLowerCase().split(" ").some((wd) => wd.length > 4 && query.includes(wd)));
    if (hit) {
      return {
        text: `**${hit.name}** — current value: ${fmtNum(hit.value)}${hit.unit === "%" ? "%" : ""}\n\n${hit.description}\n\n**Formula:** \`${hit.formula}\`\n\n**Status:** ${hit.status}${hit.changePct !== null ? ` · ${fmtSigned(hit.changePct, 1)} vs prior window` : ""}`,
      };
    }
    return {
      text: `I can explain any discovered KPI. Available: ${a.kpis.slice(0, 10).map((k) => k.name).join(", ")}. Try “Explain ${a.kpis[0]?.name ?? "Network Health Score"}”.`,
    };
  }

  /* ------------------------------ growth intent ---------------------------- */
  if (/growth|trend|increas|grow/.test(query)) {
    const g = a.kpis.find((k) => k.name === "Traffic Growth Rate" || k.name === "Growth Rate");
    const fastest = [...a.entityStats].sort((x, y) => y.growthPctPerWeek - x.growthPctPerWeek).slice(0, 5);
    return {
      text: `${g ? `Network-wide growth is **${fmtSigned(g.value, 1)} per week**.` : "Growth rate could not be computed (insufficient history)."}${
        fastest.length ? `\n\nFastest-growing elements:\n${fastest.map((e, i) => `${i + 1}. ${e.entity} — ${fmtSigned(e.growthPctPerWeek, 1)}/wk (${e.region})`).join("\n")}` : ""
      }`,
    };
  }

  /* -------------------------------- subscribers ---------------------------- */
  if (/subscriber|customer|impact/.test(query)) {
    const k = a.kpis.find((x) => x.name === "Subscriber Impact");
    if (!k) return { text: "No subscriber column was detected, so impact sizing is unavailable for this dataset." };
    const top = a.regionStats.filter((r) => r.subscribersImpacted > 0).sort((x, y) => y.subscribersImpacted - x.subscribersImpacted);
    return {
      text: `≈**${fmtNum(k.value, 0)} subscribers** are homed on elements that experienced congestion in this window.${
        top.length ? ` Largest exposure: ${top.slice(0, 3).map((r) => `${r.region} (${fmtNum(r.subscribersImpacted, 0)})`).join(", ")}.` : ""
      }`,
    };
  }

  /* --------------------------------- fallback ------------------------------ */
  return {
    text: `I analyze the uploaded dataset directly. Try one of these:\n• "Why is congestion increasing?"\n• "Which region is most affected?"\n• "Show top 10 congested elements"\n• "Predict next month's utilization"\n• "When will capacity saturate?"\n• "Explain the Network Health Score"\n• "Generate a CTO report"`,
  };
}
