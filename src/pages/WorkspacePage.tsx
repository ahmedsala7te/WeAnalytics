import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
// motion still used for tab underline + copilot slide
import { Bot, Clock, Database, FileSearch, MessageSquareText, UploadCloud } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { FilterBar } from "@/components/FilterBar";
import { CopilotPanel } from "@/components/CopilotPanel";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { fmtNum, fmtTimeAgo } from "@/lib/format";
import { healthColor } from "@/lib/constants";
import type { PersonaId } from "@/lib/types";

export function WorkspacePage() {
  const analysis = useAppStore((s) => s.viewAnalysis);
  const persona = useAppStore((s) => s.persona);
  const setPersona = useAppStore((s) => s.setPersona);
  const [copilotOpen, setCopilotOpen] = useState(true);

  const dashboards = analysis?.dashboards ?? [];
  const active = useMemo(
    () => dashboards.find((d) => d.persona === persona) ?? dashboards[0],
    [dashboards, persona]
  );

  // keep persona valid when switching between telecom/generic datasets
  useEffect(() => {
    if (dashboards.length > 0 && !dashboards.some((d) => d.persona === persona)) {
      setPersona(dashboards[0].persona);
    }
  }, [dashboards, persona, setPersona]);

  if (!analysis) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-400">
            <FileSearch size={28} />
          </div>
          <h2 className="mt-5 text-xl font-bold text-primary">No analysis yet</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            Upload a dataset or load a sample from the Data Hub — the AI pipeline will generate persona dashboards,
            insights and forecasts automatically.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-glow transition-all hover:bg-accent-400"
          >
            <UploadCloud size={16} /> Go to Data Hub
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ------------------------------ main column ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* sticky header */}
        <header className="glass sticky top-0 z-20 border-b border-subtle px-5 pb-0 pt-3.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Database size={13} className="shrink-0 text-accent-400" />
                <h1 className="truncate text-[15px] font-bold tracking-tight text-primary" title={analysis.datasetName}>
                  {analysis.datasetName}
                </h1>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
                <span>{fmtNum(analysis.rowsAnalyzed, 0)} rows</span>
                {analysis.timeRange && <span>{analysis.timeRange.days} days</span>}
                <span className="flex items-center gap-1">
                  <Clock size={10} /> analyzed {fmtTimeAgo(analysis.generatedAt)} in {(analysis.durationMs / 1000).toFixed(1)}s
                </span>
                <span
                  className="rounded-full px-1.5 py-px font-bold"
                  style={{ color: healthColor(analysis.healthScore), background: `${healthColor(analysis.healthScore)}1a` }}
                >
                  Health {analysis.healthScore.toFixed(1)}
                </span>
              </div>
            </div>

            {/* domain confidence badges */}
            <div className="hidden items-center gap-1.5 lg:flex">
              {analysis.domains.slice(0, 3).map((d, i) => (
                <span
                  key={d.domain}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    i === 0 ? "border-accent-500/50 bg-accent-500/10 text-accent-400" : "border-subtle text-muted"
                  }`}
                >
                  {d.domain} {d.confidence}%
                </span>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setCopilotOpen(!copilotOpen)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                  copilotOpen
                    ? "border-accent-500/50 bg-accent-500/10 text-accent-400"
                    : "border-subtle text-secondary hover:border-strong"
                }`}
              >
                <MessageSquareText size={13} />
                Copilot
              </button>
            </div>
          </div>

          {/* persona tabs */}
          <nav className="mt-2.5 flex items-center gap-1 overflow-x-auto">
            {dashboards.map((d) => (
              <button
                key={d.persona}
                onClick={() => setPersona(d.persona as PersonaId)}
                className={`relative whitespace-nowrap rounded-t-lg px-3.5 py-2 text-[12px] font-semibold transition-colors ${
                  active?.persona === d.persona ? "text-accent-400" : "text-muted hover:text-primary"
                }`}
                title={d.description}
              >
                {d.title}
                {active?.persona === d.persona && (
                  <motion.div layoutId="tab-underline" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-500" />
                )}
              </button>
            ))}
          </nav>
        </header>

        {/* filter bar */}
        <div className="border-b border-subtle px-5 py-2.5">
          <FilterBar />
        </div>

        {/* bento grid — keyed remount per persona; no exit animation so tab
            switches never block on throttled rAF (background windows) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div
            key={`${analysis.datasetId}-${active?.persona}-${analysis.generatedAt}`}
            className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-2 xl:grid-cols-4"
          >
            {active?.widgets.map((spec, i) => (
              <WidgetRenderer key={spec.id} spec={spec} analysis={analysis} index={i} />
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------ copilot panel ----------------------------- */}
      <AnimatePresence>
        {copilotOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 372, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-l border-subtle bg-surface"
          >
            <div className="h-full w-[372px]">
              <CopilotPanel onClose={() => setCopilotOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* floating copilot toggle when closed */}
      {!copilotOpen && (
        <button
          onClick={() => setCopilotOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-info-500 text-white shadow-glow transition-transform hover:scale-105"
          title="Open AI Copilot"
        >
          <Bot size={20} />
        </button>
      )}
    </div>
  );
}
