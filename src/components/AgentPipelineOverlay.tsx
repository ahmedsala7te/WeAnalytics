import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Check, CircleDashed, Loader2, MinusCircle, Sparkles } from "lucide-react";
import { AGENTS } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";

export function AgentPipelineOverlay() {
  const visible = useAppStore((s) => s.pipelineVisible);
  const running = useAppStore((s) => s.pipelineRunning);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const hide = useAppStore((s) => s.hidePipeline);
  const analysis = useAppStore((s) => s.viewAnalysis);
  const navigate = useNavigate();

  const doneCount = Object.values(agentStatus).filter((a) => a.status === "done" || a.status === "skipped").length;
  const progress = Math.round((doneCount / AGENTS.length) * 100);

  const openWorkspace = () => {
    hide();
    navigate("/workspace");
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617]/80 p-4 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="glass w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl"
          >
            {/* header */}
            <div className="relative border-b border-subtle px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
                  {running ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-primary">
                    {running ? "AI agents are analyzing your data" : "Analysis complete"}
                  </h2>
                  <p className="text-xs text-muted">
                    {running
                      ? "Multi-agent pipeline · domain detection → KPIs → intelligence → dashboards"
                      : analysis
                        ? `${analysis.domains[0]?.domain} ${analysis.domains[0]?.confidence}% · ${analysis.kpis.length} KPIs · ${analysis.dashboards.length} dashboards · ${(analysis.durationMs / 1000).toFixed(1)}s`
                        : ""}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-lg font-bold tabular-nums text-primary">{progress}%</div>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-navy-800/60">
                <motion.div
                  className="h-full bg-gradient-to-r from-accent-500 to-info-500"
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "easeOut" }}
                />
              </div>
            </div>

            {/* agent list */}
            <div className="max-h-[46vh] overflow-y-auto px-3 py-2">
              {AGENTS.map((agent) => {
                const st = agentStatus[agent.key]?.status ?? "pending";
                const note = agentStatus[agent.key]?.note;
                return (
                  <div
                    key={agent.key}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      st === "running" ? "bg-accent-500/8" : ""
                    }`}
                  >
                    <div className="w-6 text-center text-[10px] font-bold text-muted tabular-nums">{agent.index}</div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                      {st === "pending" && <CircleDashed size={15} className="text-muted opacity-50" />}
                      {st === "running" && <Loader2 size={16} className="animate-spin text-accent-400" />}
                      {st === "done" && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-5 w-5 items-center justify-center rounded-full bg-success-500/20">
                          <Check size={12} className="text-success-500" strokeWidth={3} />
                        </motion.div>
                      )}
                      {st === "skipped" && <MinusCircle size={15} className="text-muted" />}
                      {st === "error" && <MinusCircle size={15} className="text-critical-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12.5px] font-semibold ${st === "pending" ? "text-muted" : "text-primary"}`}>
                        {agent.name}
                      </div>
                      <div className="truncate text-[10.5px] text-muted">
                        {st === "running" ? (note ?? agent.blurb) : st === "pending" ? agent.blurb : (note ?? agent.blurb)}
                      </div>
                    </div>
                    {st === "running" && <Bot size={14} className="animate-pulse text-accent-400" />}
                  </div>
                );
              })}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between border-t border-subtle px-6 py-4">
              <p className="text-[11px] text-muted">
                {running ? "Runs locally in your browser — data never leaves the OSS environment" : "Dashboards, insights and the AI assistant are ready."}
              </p>
              <button
                onClick={openWorkspace}
                disabled={running}
                className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[13px] font-semibold text-white shadow-glow transition-all hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                Open dashboards <ArrowRight size={15} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
