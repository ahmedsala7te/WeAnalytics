import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  Cpu,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Presentation,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  Wand2,
  X,
} from "lucide-react";
import { SUGGESTED_QUESTIONS } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";
import { EChart } from "@/components/EChart";
import { chatChartOption } from "@/components/charts/options";
import { exportCongestionCsv, exportKpiCsv, exportPdf, exportPptx, exportXlsx } from "@/agents/reporting";
import type { ChatMessage } from "@/lib/types";

/** Minimal markdown: **bold**, `code`, newlines, bullet lines. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
        return (
          <p key={i} className={`text-[12px] leading-relaxed ${line.startsWith("•") || /^\d+\./.test(line) ? "pl-2" : ""}`}>
            {parts.map((p, j) =>
              p.startsWith("**") ? (
                <strong key={j} className="font-semibold text-primary">
                  {p.slice(2, -2)}
                </strong>
              ) : p.startsWith("`") ? (
                <code key={j} className="rounded bg-inset px-1 py-0.5 font-mono text-[10.5px] text-accent-400">
                  {p.slice(1, -1)}
                </code>
              ) : (
                <span key={j}>{p}</span>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}

function Message({ msg }: { msg: ChatMessage }) {
  const dark = useAppStore((s) => s.theme) === "dark";
  const applySuggested = useAppStore((s) => s.applySuggestedActions);
  const isUser = msg.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          isUser ? "bg-navy-700 text-slate-300" : "bg-accent-500/15 text-accent-400"
        }`}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${isUser ? "rounded-tr-sm bg-accent-500 text-white" : "rounded-tl-sm border border-subtle bg-surface-2 text-secondary"}`}>
        {isUser ? (
          <p className="text-[12px] leading-relaxed">{msg.text}</p>
        ) : (
          <>
            {msg.text ? <Rich text={msg.text} /> : <span className="text-[12px] text-muted">Thinking…</span>}
            {msg.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse-dot bg-accent-400 align-middle" />}
          </>
        )}
        {msg.chart && !msg.streaming && (
          <div className="mt-2 overflow-hidden rounded-lg border border-subtle bg-surface p-1">
            <EChart option={chatChartOption(dark, msg.chart)} height={Math.max(150, Math.min(230, msg.chart.labels.length * 22))} />
          </div>
        )}
        {!isUser && (msg.applied?.length || msg.failed?.length) ? (
          <div className="mt-2 space-y-1 rounded-lg border border-subtle bg-surface p-2.5">
            {msg.applied?.map((t, i) => (
              <div key={`a${i}`} className="flex items-start gap-1.5 text-[11.5px] text-secondary">
                <Check size={12} className="mt-0.5 shrink-0 text-success-500" strokeWidth={3} />
                {t}
              </div>
            ))}
            {msg.failed?.map((t, i) => (
              <div key={`f${i}`} className="flex items-start gap-1.5 text-[11.5px] text-warning-500">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {t}
              </div>
            ))}
          </div>
        ) : null}
        {!isUser && !msg.streaming && msg.suggestedActions?.length ? (
          <button
            onClick={() => applySuggested(msg.id)}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-accent-500/50 bg-accent-500/10 px-2.5 py-1.5 text-[11.5px] font-bold text-accent-400 transition-all hover:bg-accent-500 hover:text-white"
          >
            <Wand2 size={12} /> Apply to dashboard ({msg.suggestedActions.length} change{msg.suggestedActions.length === 1 ? "" : "s"})
          </button>
        ) : null}
        {!isUser && msg.engine && !msg.streaming && (
          <div className="mt-1.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted">
            <Cpu size={9} />
            {msg.engine === "rules" ? "deterministic engine" : `${msg.engine} · local`}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function CopilotPanel({ onClose }: { onClose?: () => void }) {
  const chat = useAppStore((s) => s.chat);
  const busy = useAppStore((s) => s.chatBusy);
  const ask = useAppStore((s) => s.ask);
  const askDashboard = useAppStore((s) => s.askDashboard);
  const chatMode = useAppStore((s) => s.chatMode);
  const setChatMode = useAppStore((s) => s.setChatMode);
  const clearChat = useAppStore((s) => s.clearChat);
  const stopGeneration = useAppStore((s) => s.stopGeneration);
  const analysis = useAppStore((s) => s.viewAnalysis);
  const llm = useAppStore((s) => s.llm);
  const dark = useAppStore((s) => s.theme) === "dark";
  const logAudit = useAppStore((s) => s.logAudit);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = chat.some((m) => m.streaming);
  const dashboardMode = chatMode === "dashboard";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, busy]);

  const submit = async (q: string) => {
    if (!q.trim() || busy) return;
    setDraft("");
    if (dashboardMode) {
      await askDashboard(q.trim());
      return;
    }
    const reply = await ask(q.trim());
    if (reply?.action && analysis) {
      // chat-triggered export
      setTimeout(() => {
        if (reply.action === "export-pdf") exportPdf(analysis, dark);
        if (reply.action === "export-pptx") void exportPptx(analysis, dark);
        if (reply.action === "export-xlsx") exportXlsx(analysis);
        logAudit("EXPORT", `Assistant-triggered ${reply.action}`);
      }, 400);
    }
  };

  const doExport = (kind: string) => {
    if (!analysis) return;
    if (kind === "pdf") exportPdf(analysis, dark);
    if (kind === "pptx") void exportPptx(analysis, dark);
    if (kind === "xlsx") exportXlsx(analysis);
    if (kind === "kpi-csv") exportKpiCsv(analysis);
    if (kind === "events-csv") exportCongestionCsv(analysis);
    logAudit("EXPORT", kind);
  };

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-subtle px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-info-500 text-white shadow-glow">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold text-primary">AI Copilot</h3>
          <p className="truncate text-[10.5px] text-muted">
            {llm.status === "connected" ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success-500" /> {llm.model} · local LLM
              </span>
            ) : (
              "Answers grounded in the uploaded dataset"
            )}
          </p>
        </div>
        {chat.length > 0 && (
          <button onClick={clearChat} title="Clear conversation" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-critical-500">
            <Trash2 size={14} />
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-primary xl:hidden">
            <X size={15} />
          </button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        {chat.length === 0 && (
          <div className="space-y-3">
            <div className="rounded-2xl rounded-tl-sm border border-subtle bg-surface-2 px-3 py-2.5">
              <p className="text-[12px] leading-relaxed text-secondary">
                {dashboardMode ? (
                  <>
                    Dashboard mode — tell me how to change the workspace and I'll apply it:{" "}
                    <strong className="text-primary">filter regions or dates, add/remove charts, switch views</strong>. Switch back to
                    Answer mode for Q&A.
                  </>
                ) : (
                  <>
                    Hi — I'm your network analytics copilot. I've indexed{" "}
                    <strong className="text-primary">{analysis ? analysis.datasetName : "no dataset yet"}</strong>
                    {analysis
                      ? ` (${analysis.rowsAnalyzed.toLocaleString()} rows). Ask me anything about congestion, capacity, forecasts or alarms.`
                      : ". Upload data to begin."}
                  </>
                )}
              </p>
            </div>
            {analysis && (
              <div className="flex flex-wrap gap-1.5">
                {(dashboardMode ? dashboardSuggestions(analysis) : SUGGESTED_QUESTIONS).map((q) => (
                  <button
                    key={q}
                    onClick={() => void submit(q)}
                    className="rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] text-secondary transition-colors hover:border-accent-500/50 hover:text-accent-400"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m) => (
            <Message key={m.id} msg={m} />
          ))}
        </AnimatePresence>
        {busy && !streaming && (
          <div className="flex items-center gap-2 pl-9 text-[11.5px] text-muted">
            <Loader2 size={13} className="animate-spin text-accent-400" />
            {llm.status === "connected" ? `${llm.model} is reading the analysis…` : "Analyzing your question…"}
          </div>
        )}
        {streaming && (
          <div className="flex items-center gap-2 pl-9">
            <button
              onClick={stopGeneration}
              className="flex items-center gap-1.5 rounded-lg border border-subtle bg-surface px-2.5 py-1 text-[11px] font-semibold text-secondary transition-colors hover:border-critical-500/50 hover:text-critical-500"
            >
              <Square size={10} /> Stop generating
            </button>
          </div>
        )}
      </div>

      {/* export shortcuts */}
      {analysis && (
        <div className="flex items-center gap-1.5 border-t border-subtle px-3 py-2">
          <span className="flex items-center gap-1 pr-1 text-[10px] font-bold uppercase tracking-wider text-muted">
            <Download size={11} /> Export
          </span>
          <ExportBtn icon={FileText} label="PDF" onClick={() => doExport("pdf")} />
          <ExportBtn icon={Presentation} label="PPTX" onClick={() => doExport("pptx")} />
          <ExportBtn icon={FileSpreadsheet} label="Excel" onClick={() => doExport("xlsx")} />
          <ExportBtn icon={FileText} label="CSV" onClick={() => doExport("kpi-csv")} />
        </div>
      )}

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
        className="border-t border-subtle p-3"
      >
        {/* answer ↔ dashboard mode toggle */}
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-subtle bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setChatMode("chat")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-all ${
              !dashboardMode ? "bg-accent-500 text-white shadow-glow" : "text-muted hover:text-primary"
            }`}
            title="Replies answer in chat"
          >
            <MessageSquareText size={12} /> Answer
          </button>
          <button
            type="button"
            onClick={() => setChatMode("dashboard")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-all ${
              dashboardMode ? "bg-accent-500 text-white shadow-glow" : "text-muted hover:text-primary"
            }`}
            title="Requests are applied to the dashboard"
          >
            <LayoutDashboard size={12} /> Apply to dashboard
          </button>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-subtle bg-surface-2 p-1.5 focus-within:border-accent-500/60">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(draft);
              }
            }}
            rows={1}
            placeholder={!analysis ? "Upload data first…" : dashboardMode ? "Tell me how to change the dashboard…" : "Ask about your network…"}
            disabled={!analysis}
            className="max-h-28 flex-1 resize-none bg-transparent px-2 py-1.5 text-[12.5px] text-primary placeholder:text-muted focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy || !analysis}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-all disabled:opacity-30 ${
              dashboardMode ? "bg-gradient-to-br from-accent-500 to-info-500 hover:opacity-90" : "bg-accent-500 hover:bg-accent-400"
            }`}
            title={dashboardMode ? "Apply to dashboard" : "Send"}
          >
            {dashboardMode ? <Wand2 size={14} /> : <Send size={14} />}
          </button>
        </div>
      </form>
    </aside>
  );
}

function dashboardSuggestions(a: {
  regionStats: { region: string; riskScore: number }[];
  timeRange: unknown;
  measureIsPct: boolean;
  dashboards: { persona: string }[];
  topEntityDaily: unknown[];
  kpis: { name: string }[];
}): string[] {
  const worst = [...a.regionStats].sort((x, y) => y.riskScore - x.riskScore)[0]?.region;
  return [
    ...(worst ? [`Focus on ${worst}`] : []),
    a.measureIsPct ? "Add a top 20 congested table" : "Add a top 10 worst elements table",
    ...(a.topEntityDaily.length > 1 ? ["Add bars per element for each day"] : []),
    ...(a.kpis.length > 4 ? [`Remove the ${a.kpis[a.kpis.length - 1].name} KPI card`] : []),
    ...(a.timeRange ? ["Last 7 days"] : []),
    "Make the trend full width",
    ...(a.dashboards.some((d) => d.persona === "capacity") ? ["Switch to capacity view"] : []),
    "Reset dashboard",
  ];
}

function ExportBtn({ icon: Icon, label, onClick }: { icon: typeof FileText; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2 py-1 text-[10.5px] font-semibold text-secondary transition-colors hover:border-accent-500/50 hover:text-accent-400"
    >
      <Icon size={11} /> {label}
    </button>
  );
}
