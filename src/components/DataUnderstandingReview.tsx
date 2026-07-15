import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Bot, CheckCircle2, Database, Gauge, Info, Loader2, Sparkles, Table2, X, type LucideIcon } from "lucide-react";
import { fmtNum, fmtPct } from "@/lib/format";
import { TELECOM_BUSINESS_CASE_OPTIONS } from "@/agents/telecomBusinessCases";
import type { ColumnProfile, DataUnderstandingReport, LlmState, TelecomBusinessCaseId } from "@/lib/types";
import type { ReactNode } from "react";

const WARNING_STYLE = {
  info: "border-info-500/30 bg-info-500/8 text-info-500",
  warning: "border-warning-500/30 bg-warning-500/8 text-warning-500",
  critical: "border-critical-500/30 bg-critical-500/8 text-critical-500",
} as const;

const EXAMPLES = [
  "Build an executive dashboard focused on growth, risk, and the most important segments.",
  "Find congestion risk and prioritize capacity upgrades by region and element.",
  "Create a sales dashboard showing revenue trend, top products, and regional performance.",
];

export function DataUnderstandingReview({
  report,
  llm,
  queueCount = 1,
  planning = false,
  onConfirm,
  onCancel,
}: {
  report: DataUnderstandingReport;
  llm: LlmState;
  queueCount?: number;
  planning?: boolean;
  onConfirm: (prompt: string, useLlmPlanner: boolean, selectedCaseId: TelecomBusinessCaseId) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<TelecomBusinessCaseId>(report.businessContext.selectedCaseId);
  useEffect(() => setSelectedCaseId(report.businessContext.selectedCaseId), [report]);
  const topDomain = report.domains[0];
  const columnPreview = useMemo(
    () =>
      report.profile
        .slice()
        .sort((a, b) => roleWeight(b.role) - roleWeight(a.role) || a.nullPct - b.nullPct)
        .slice(0, 18),
    [report.profile]
  );
  const llmReady = llm.status === "connected" && !!llm.model;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617]/75 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="glass flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-subtle"
      >
        <header className="flex items-start gap-4 border-b border-subtle px-5 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-500/12 text-accent-400">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent-400">LLM Dashboard Planner</p>
            <h2 className="mt-0.5 truncate text-[18px] font-extrabold text-primary">{report.dataset.name}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              NetPulse profiled the file. Add an optional instruction, then local Ollama can plan the dashboard before deterministic analysis computes the numbers.
              {queueCount > 1 && <span className="ml-1 text-accent-400">{queueCount} files queued for review.</span>}
            </p>
          </div>
          <button disabled={planning} onClick={onCancel} className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-primary disabled:opacity-40">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 lg:grid-cols-4">
            <MetricCard icon={Database} label="Rows" value={fmtNum(report.quality.rows, 0)} detail={`${report.quality.columns} columns`} />
            <MetricCard icon={Gauge} label="Domain Match" value={`${topDomain?.domain ?? "Unknown"} ${topDomain?.confidence ?? 0}%`} detail="Heuristic match score" />
            <MetricCard icon={Table2} label="Column Roles" value={`${report.quality.numericColumns} numeric`} detail={`${report.quality.datetimeColumns} date · ${report.quality.categoricalColumns} category`} />
            <MetricCard icon={Info} label="Null Average" value={fmtPct(report.quality.averageNullPct)} detail={report.transformed ? "Reshaped before analysis" : "Original table shape"} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="panel p-4">
              <div className="flex items-center gap-2">
                <Bot size={15} className="text-accent-400" />
                <h3 className="text-[13px] font-bold text-primary">Tell the LLM what dashboard you want</h3>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    llmReady ? "bg-success-500/12 text-success-500" : "bg-warning-500/12 text-warning-500"
                  }`}
                >
                  {llmReady ? `${llm.model} connected` : "Ollama off"}
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="Example: Build an executive dashboard focused on revenue growth by region, top segments, and anomalies."
                className="mt-3 w-full resize-none rounded-xl border border-subtle bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-primary placeholder:text-muted focus:border-accent-500 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setPrompt(ex)}
                    className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-[10.5px] font-semibold text-secondary transition-colors hover:border-accent-500/60 hover:text-accent-400"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {!llmReady && (
                <div className="mt-3 rounded-xl border border-warning-500/30 bg-warning-500/8 p-3 text-[12px] leading-relaxed text-warning-500">
                  Local Ollama is not connected. You can still continue with the deterministic dashboard rules, or connect Ollama from Settings and try again.
                </div>
              )}
            </div>

            <div className="panel overflow-hidden p-4">
              <div className="flex items-center gap-2">
                <Table2 size={15} className="text-accent-400" />
                <h3 className="text-[13px] font-bold text-primary">What the file contains</h3>
              </div>
              <div className="mt-3 grid gap-2 text-[12px] text-secondary">
                <MappingLine label="Timestamp" value={report.mapping.timestamp} />
                <MappingLine label="Entity / Segment" value={report.mapping.entity} />
                <MappingLine label="Region / Group" value={report.mapping.region} />
                <MappingLine label="Latitude" value={report.mapping.latitude} />
                <MappingLine label="Longitude" value={report.mapping.longitude} />
                <MappingLine label="Primary Measure" value={report.mapping.primaryMeasure} />
                <MappingLine label="Utilization" value={report.mapping.utilization} />
                <MappingLine label="Traffic / Volume" value={report.mapping.traffic} />
              </div>
              <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-subtle">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="bg-surface-2">
                      <Th>Column</Th>
                      <Th>Role</Th>
                      <Th>Semantic</Th>
                      <Th>Nulls</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {columnPreview.map((p) => (
                      <tr key={p.name} className="border-t border-subtle">
                        <td className="max-w-52 truncate px-3 py-2 font-semibold text-primary" title={p.name}>{p.name}</td>
                        <td className="px-3 py-2 text-secondary">{p.role}</td>
                        <td className="px-3 py-2 text-muted">{p.semantic === "none" ? "—" : p.semantic}</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{fmtPct(p.nullPct, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="mt-4 panel p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Gauge size={15} className="text-accent-400" />
                  <h3 className="text-[13px] font-bold text-primary">Detected Business Goal</h3>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  NetPulse selected the most likely telecom operations playbook. Correct it if the daily report is for a different decision.
                </p>
              </div>
              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value as TelecomBusinessCaseId)}
                className="min-w-72 rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-[12px] font-semibold text-primary focus:border-accent-500 focus:outline-none"
              >
                {TELECOM_BUSINESS_CASE_OPTIONS.map((option) => {
                  const candidate = report.businessContext.candidates.find((c) => c.id === option.id);
                  return (
                  <option key={option.id} value={option.id}>
                    {option.label}{candidate ? ` · ${candidate.score}%` : ""}
                  </option>
                  );
                })}
              </select>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {report.businessContext.candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    selectedCaseId === c.id ? "border-accent-500 bg-accent-500/10" : "border-subtle bg-surface-2 hover:border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold text-primary">{c.label}</span>
                    <span className="rounded-full bg-inset px-1.5 py-px text-[10px] font-bold text-accent-400">{c.score}%</span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{c.reasons.slice(0, 2).join(" · ") || "Matched from telecom report shape."}</p>
                </button>
              ))}
            </div>
          </section>

          {(report.transformNote || report.warnings.length > 0) && (
            <section className="mt-4 grid gap-2 lg:grid-cols-2">
              {report.transformNote && (
                <div className="rounded-xl border border-info-500/30 bg-info-500/8 p-3 text-[12px] leading-relaxed text-info-500">
                  <span className="font-bold">Transformation:</span> {report.transformNote}
                </div>
              )}
              {report.warnings.map((w, i) => (
                <div key={`${w.severity}-${i}`} className={`rounded-xl border p-3 text-[12px] leading-relaxed ${WARNING_STYLE[w.severity]}`}>
                  <span className="font-bold">{w.severity === "critical" ? "Action needed:" : w.severity === "warning" ? "Check:" : "Note:"}</span> {w.message}
                </div>
              ))}
            </section>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-5 py-4">
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <CheckCircle2 size={14} className="text-success-500" />
            The LLM plans layout only. All numbers still come from deterministic agents.
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={planning} onClick={onCancel} className="rounded-lg border border-subtle px-4 py-2 text-[12px] font-semibold text-secondary transition-colors hover:border-strong disabled:opacity-50">
              Cancel
            </button>
            <button
              disabled={planning}
              onClick={() => onConfirm(prompt, false, selectedCaseId)}
              className="rounded-lg border border-subtle px-4 py-2 text-[12px] font-semibold text-secondary transition-colors hover:border-strong disabled:opacity-50"
            >
              Use deterministic dashboard
            </button>
            <button
              disabled={planning}
              onClick={() => onConfirm(prompt, true, selectedCaseId)}
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[12px] font-bold text-white shadow-glow transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {planning && <Loader2 size={13} className="animate-spin" />}
              {llmReady ? "Ask LLM and generate" : "Generate with fallback"}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-accent-400">
        <Icon size={15} />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="mt-2 text-[18px] font-extrabold text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{detail}</div>
    </div>
  );
}

function MappingLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-inset px-2.5 py-1.5">
      <span className="text-muted">{label}</span>
      <span className="max-w-56 truncate font-semibold text-primary" title={value}>{value ?? "Not detected"}</span>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.07em] text-muted">{children}</th>;
}

function roleWeight(role: ColumnProfile["role"]): number {
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
