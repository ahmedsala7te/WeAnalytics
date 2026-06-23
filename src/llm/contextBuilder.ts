import { fmtDate } from "@/lib/format";
import type { AnalysisResult } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Builds the grounding context handed to the local LLM. Kept compact
 * (~4 KB) because CPU-only prefill is slow, and kept STABLE per dataset so
 * Ollama's prompt-prefix cache accelerates follow-up questions.
 * ---------------------------------------------------------------------- */

export function buildAnalysisDigest(a: AnalysisResult): string {
  const L: string[] = [];
  L.push(`DATASET: ${a.datasetName} — ${a.rowsAnalyzed.toLocaleString()} rows`);
  if (a.timeRange) L.push(`WINDOW: ${fmtDate(a.timeRange.start)} to ${fmtDate(a.timeRange.end)} (${a.timeRange.days} days)`);
  L.push(`DOMAIN: ${a.domains.slice(0, 2).map((d) => `${d.domain} ${d.confidence}%`).join(", ")}`);
  // a network-utilization health score only applies when there's a utilization %
  if (a.measureIsPct) {
    L.push(`NETWORK HEALTH SCORE: ${a.healthScore.toFixed(1)}/100`);
  } else {
    L.push(`ANALYSIS TYPE: ${a.measureLabel} breakdown by ${a.entityStats.length} segments — this is NOT a congestion/utilization dataset, do not describe it as network health or congestion.`);
  }

  L.push(`\nKPIs (value | change vs prior week | status):`);
  for (const k of a.kpis.slice(0, 14)) {
    const unit = k.unit === "%" ? "%" : k.unit === "raw" ? "" : ` ${k.unit}`;
    L.push(
      `- ${k.name}: ${k.value.toFixed(1)}${unit}${
        k.changePct !== null ? ` | ${k.changePct > 0 ? "+" : ""}${k.changePct.toFixed(1)}%` : ""
      } | ${k.status}`
    );
  }

  const pct = a.measureIsPct;
  const ml = a.measureLabel;
  if (a.regionStats.length > 1) {
    L.push(
      pct
        ? `\nREGIONS (health | congested/total elements | chronic | growth %/wk | subs impacted):`
        : `\nREGIONS (health | elements | avg ${ml} | trend %/wk | subscribers):`
    );
    for (const r of a.regionStats.slice(0, 10)) {
      L.push(
        pct
          ? `- ${r.region}: ${r.healthScore.toFixed(0)} | ${r.congestedEntities}/${r.entities} | ${r.chronicEntities} | ${r.growthPctPerWeek.toFixed(1)} | ${r.subscribersImpacted}`
          : `- ${r.region}: ${r.healthScore.toFixed(0)} | ${r.entities} | ${r.avgUtil.toFixed(0)} | ${r.growthPctPerWeek.toFixed(1)} | ${r.subscribersImpacted}`
      );
    }
  }

  const topRisk = a.entityStats.slice(0, 8);
  if (topRisk.length) {
    L.push(
      pct
        ? `\nTOP RISK ELEMENTS (risk | p95 util | congested hrs | growth %/wk | saturation date):`
        : `\nTOP RISK ELEMENTS (risk | avg ${ml} | peak ${ml} | trend %/wk | subscribers):`
    );
    for (const e of topRisk) {
      L.push(
        pct
          ? `- ${e.entity} (${e.region}): ${e.riskScore.toFixed(0)} | ${e.p95Util.toFixed(0)}% | ${e.congestedHours} | ${e.growthPctPerWeek.toFixed(1)} | ${
              e.saturationDate ? fmtDate(e.saturationDate) : ">180d"
            }${e.chronic ? " | CHRONIC" : ""}`
          : `- ${e.entity} (${e.region}): ${e.riskScore.toFixed(0)} | ${e.avgUtil.toFixed(0)} | ${e.peakUtil.toFixed(0)} | ${e.growthPctPerWeek.toFixed(1)} | ${e.subscribers ?? "?"}`
      );
    }
  }

  if (a.rootCauses.length) {
    L.push(`\nROOT CAUSE FINDINGS:`);
    for (const rc of a.rootCauses.slice(0, 4)) {
      L.push(`- [${rc.scope}] ${rc.what} WHY: ${rc.why}`);
    }
  }

  const sat = a.forecasts.find((f) => f.saturationDate);
  if (a.forecasts.length) {
    L.push(`\nFORECASTS (Holt smoothing):`);
    for (const f of a.forecasts.slice(0, 3)) {
      const last = f.history[f.history.length - 1]?.v ?? 0;
      const end = f.forecast[f.forecast.length - 1]?.v ?? 0;
      L.push(
        `- ${f.name}: now ${last.toFixed(1)} → ${end.toFixed(1)} in ${f.forecast.length}d${
          f.saturationDate ? ` | crosses ${f.saturationThreshold}% ~${fmtDate(f.saturationDate)}` : ""
        }`
      );
    }
    if (!sat) L.push(`- No saturation crossing projected within horizon.`);
  }

  if (a.anomalies.length) {
    L.push(`\nANOMALIES:`);
    for (const an of a.anomalies.slice(0, 5)) L.push(`- ${an.text}`);
  }

  if (a.correlations.length) {
    L.push(`\nCORRELATIONS: ${a.correlations.slice(0, 4).map((c) => `${c.a}↔${c.b} r=${c.r.toFixed(2)}`).join("; ")}`);
  }

  const busy = a.busyHourProfile;
  if (busy.length === 24) {
    const vals = busy.map((v) => v ?? 0);
    const bh = vals.indexOf(Math.max(...vals));
    L.push(`BUSY HOUR: ${String(bh).padStart(2, "0")}:00 at ${vals[bh].toFixed(1)}% avg utilization`);
  }

  return L.join("\n");
}

export function buildChatSystemPrompt(a: AnalysisResult): string {
  const congestionLine = a.measureIsPct
    ? "- Thresholds used by the platform: congestion ≥90% utilization, critical ≥95%, chronic = congested ≥5 days in 14, SLA target 99.9% availability."
    : `- This dataset has NO utilization/congestion metric. It is a ${a.measureLabel} breakdown across ${a.entityStats.length} segments. Do NOT mention congestion, saturation, network health scores, or alarms — they do not apply. Talk in terms of ${a.measureLabel}, subscribers, segments, shares and growth.`;
  return `You are the AI copilot inside NetPulse, a telecom network intelligence platform. A deterministic analytics pipeline has already analyzed the uploaded dataset. Its complete findings are below — this is your ONLY source of truth.

RULES:
- Answer ONLY from the findings below. Never invent numbers, elements, regions or dates. If the findings don't contain the answer, say so plainly and suggest what data would be needed.
- Be concise and operational: lead with the answer, then 2-4 supporting facts. Use exact numbers from the findings.
- Use **bold** for key numbers and element names. Use short bullet lists where helpful. No headers, no tables.
${congestionLine}
- You may recommend grounded actions based on the findings.

=== ANALYSIS FINDINGS ===
${buildAnalysisDigest(a)}
=== END FINDINGS ===`;
}

export function buildNarrativePrompt(a: AnalysisResult): { system: string; user: string } {
  const lead = a.measureIsPct
    ? "leads with network health and the single most important fact"
    : `leads with the headline ${a.measureLabel}/subscriber figure — do NOT mention "network health score", congestion or saturation (this dataset has no utilization metric)`;
  return {
    system: `You are the executive storytelling agent of a telecom analytics platform. You write crisp, board-ready narrative for a CTO based STRICTLY on analysis findings provided by the user. Never invent numbers or names; copy element IDs, region names and figures EXACTLY as written in the findings. Respond with VALID JSON only, matching exactly this schema:
{"headline": string, "summary": string, "keyInsights": string[], "risks": string[], "recommendations": string[]}
Constraints: headline ≤ 28 words, punchy, ${lead}. summary = one paragraph of 3-5 sentences. keyInsights = 4-6 bullets, each ≤ 30 words with concrete numbers. risks = 2-4 bullets. recommendations = 3-5 imperative bullets, prioritized, with timeframes where the findings support them.`,
    user: `Write the executive narrative for this analysis:\n\n${buildAnalysisDigest(a)}`,
  };
}

export interface NarrativeJson {
  headline?: string;
  summary?: string;
  keyInsights?: string[];
  risks?: string[];
  recommendations?: string[];
}

export function parseNarrativeJson(raw: string): NarrativeJson | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as NarrativeJson;
    if (!obj.headline || !obj.summary) return null;
    const arr = (x: unknown): string[] | undefined =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : undefined;
    return {
      headline: String(obj.headline),
      summary: String(obj.summary),
      keyInsights: arr(obj.keyInsights),
      risks: arr(obj.risks),
      recommendations: arr(obj.recommendations),
    };
  } catch {
    return null;
  }
}
