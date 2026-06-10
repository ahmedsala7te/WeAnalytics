import { motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, CheckCircle2, Cpu, Lightbulb, Loader2, Search, Sparkles, TrendingUp } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { ExecutiveStory, Insight } from "@/lib/types";

const KIND_META: Record<Insight["kind"], { icon: typeof Lightbulb; label: string }> = {
  finding: { icon: Search, label: "Key Finding" },
  root_cause: { icon: AlertOctagon, label: "Root Cause" },
  risk: { icon: AlertTriangle, label: "Risk" },
  recommendation: { icon: CheckCircle2, label: "Recommendation" },
  forecast: { icon: TrendingUp, label: "Forecast" },
  anomaly: { icon: AlertTriangle, label: "Anomaly" },
};

const SEV_COLOR: Record<Insight["severity"], string> = {
  info: "#3b82f6",
  success: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
};

export function InsightsPanel({ story, insights, compact = false }: { story: ExecutiveStory; insights: Insight[]; compact?: boolean }) {
  const shown = insights.slice(0, compact ? 6 : 12);
  const enhancing = useAppStore((s) => s.llm.enhancing);
  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-1">
      {/* Executive summary header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-accent-500/25 bg-accent-500/8 p-3.5"
      >
        <div className="flex items-center gap-2 text-accent-400">
          <Sparkles size={14} />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]">AI Executive Summary</span>
          <span className="ml-auto flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted">
            {enhancing ? (
              <>
                <Loader2 size={10} className="animate-spin text-accent-400" /> LLM writing…
              </>
            ) : (
              <>
                <Cpu size={10} />
                {story.generatedBy && story.generatedBy !== "templates" ? `${story.generatedBy} · local` : "deterministic"}
              </>
            )}
          </span>
        </div>
        <p className="mt-2 text-[13px] font-semibold leading-snug text-primary">{story.headline}</p>
        {!compact && <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{story.summary}</p>}
      </motion.div>

      {shown.map((ins, i) => {
        const meta = KIND_META[ins.kind];
        const Icon = meta.icon;
        const color = SEV_COLOR[ins.severity];
        return (
          <motion.div
            key={ins.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 + i * 0.04 }}
            className="rounded-xl border border-subtle bg-surface-2 p-3"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}1c`, color }}>
                <Icon size={13} />
              </div>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color }}>
                {meta.label}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{ins.body}</p>
          </motion.div>
        );
      })}
    </div>
  );
}
