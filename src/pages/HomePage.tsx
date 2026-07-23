import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  Gauge,
  LayoutDashboard,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { SAMPLES } from "@/data/sampleGenerator";
import { buildDataUnderstanding, selectBusinessCase } from "@/agents/dataUnderstanding";
import { buildTelecomPlaybookPlan } from "@/agents/telecomBusinessCases";
import { planDashboardWithOllama } from "@/llm/dashboardPlanner";
import { useAppStore } from "@/store/useAppStore";
import { DataUnderstandingReview } from "@/components/DataUnderstandingReview";
import { fmtBytes, fmtNum, fmtTimeAgo } from "@/lib/format";
import type { DashboardPlanWarning, DataUnderstandingReport, LlmDashboardPlan, TelecomBusinessCaseId } from "@/lib/types";

const FORMATS = [
  { icon: FileSpreadsheet, label: "Excel (.xlsx)" },
  { icon: FileText, label: "CSV / TSV" },
  { icon: FileJson, label: "JSON" },
  { icon: FileText, label: "XML" },
  { icon: FolderArchive, label: "ZIP archives" },
];

const JOURNEY = [
  { icon: UploadCloud, title: "Upload", text: "Drop any network export" },
  { icon: Bot, title: "Detect", text: "AI classifies the domain" },
  { icon: Gauge, title: "Discover", text: "KPIs found automatically" },
  { icon: Sparkles, title: "Analyze", text: "Congestion, RCA, forecasts" },
  { icon: LayoutDashboard, title: "Generate", text: "Persona dashboards built" },
  { icon: ArrowRight, title: "Interact", text: "Filter, ask, export" },
];

export function HomePage() {
  const ingestAndAnalyze = useAppStore((s) => s.ingestAndAnalyze);
  const datasets = useAppStore((s) => s.datasets);
  const analyses = useAppStore((s) => s.analyses);
  const activeId = useAppStore((s) => s.activeDatasetId);
  const selectDataset = useAppStore((s) => s.selectDataset);
  const removeDataset = useAppStore((s) => s.removeDataset);
  const user = useAppStore((s) => s.user);
  const llm = useAppStore((s) => s.llm);
  const navigate = useNavigate();

  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [pendingReviews, setPendingReviews] = useState<DataUnderstandingReport[]>([]);
  const [reviewPlanning, setReviewPlanning] = useState(false);
  const [reviewAnalyzing, setReviewAnalyzing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;
      setError(null);
      setParsing(true);
      const reviews: DataUnderstandingReport[] = [];
      const errors: string[] = [];
      const { ingestFile } = await import("@/agents/ingestion");
      for (const file of list) {
        try {
          const dataset = await ingestFile(file);
          reviews.push(buildDataUnderstanding(dataset));
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : "parse failed"}`);
        }
      }
      setParsing(false);
      if (errors.length) setError(`Couldn't read ${errors.length} file(s): ${errors.join(" · ")}`);
      if (reviews.length > 0) setPendingReviews((cur) => [...cur, ...reviews]);
    },
    []
  );

  const loadSample = useCallback(
    async (id: string) => {
      const def = SAMPLES.find((s) => s.id === id);
      if (!def) return;
      setError(null);
      setLoadingSample(id);
      // let the spinner paint before the synchronous generation work
      await new Promise((r) => setTimeout(r, 60));
      try {
        const dataset = def.build();
        const review = buildDataUnderstanding(dataset);
        setLoadingSample(null);
        setPendingReviews((cur) => [...cur, review]);
      } catch (e) {
        setLoadingSample(null);
        setError(e instanceof Error ? e.message : "Failed to generate sample.");
      }
    },
    []
  );

  const confirmReview = useCallback(
    async (review: DataUnderstandingReport, prompt: string, useLlmPlanner: boolean, selectedCaseId: TelecomBusinessCaseId) => {
      setError(null);
      setReviewPlanning(true);
      const selectedReview = selectBusinessCase(review, selectedCaseId);
      let dashboardPlan: LlmDashboardPlan | undefined = buildTelecomPlaybookPlan(selectedReview, selectedCaseId, prompt);
      const dashboardPlanWarnings: DashboardPlanWarning[] = [];
      try {
        if (useLlmPlanner && llm.status === "connected" && llm.model) {
          dashboardPlan = await planDashboardWithOllama(selectedReview, prompt, { baseUrl: llm.baseUrl, model: llm.model });
        } else if (useLlmPlanner) {
          dashboardPlanWarnings.push({
            severity: "warning",
            message: "Local Ollama was not connected, so WE Autonomous OSS used the selected telecom business playbook instead.",
          });
        }
      } catch (e) {
        dashboardPlanWarnings.push({
          severity: "warning",
          message: e instanceof Error ? `Local LLM planner failed: ${e.message}. The selected telecom business playbook was used.` : "Local LLM planner failed. The selected telecom business playbook was used.",
        });
      } finally {
        setReviewPlanning(false);
      }
      setReviewAnalyzing(true);
      setPendingReviews((cur) => cur.slice(1));
      try {
        await ingestAndAnalyze(selectedReview.dataset, selectedReview, { dashboardPlan, dashboardPlanWarnings });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed after data understanding review.");
      } finally {
        setReviewAnalyzing(false);
      }
    },
    [ingestAndAnalyze, llm]
  );

  const cancelReview = useCallback(() => {
    setPendingReviews((cur) => cur.slice(1));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {!reviewAnalyzing && pendingReviews[0] && (
        <DataUnderstandingReview
          report={pendingReviews[0]}
          llm={llm}
          queueCount={pendingReviews.length}
          planning={reviewPlanning}
          onConfirm={(prompt, useLlmPlanner, selectedCaseId) => void confirmReview(pendingReviews[0], prompt, useLlmPlanner, selectedCaseId)}
          onCancel={cancelReview}
        />
      )}
      {/* ------------------------------- header ------------------------------- */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-400">
          Welcome{user ? `, ${user.name.split(" ")[0]}` : ""}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-primary">
          Turn raw network data into intelligence
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-secondary">
          Upload any telecom export — performance counters, utilization reports, alarm dumps — and the 12-agent AI
          pipeline profiles it, detects the domain, discovers KPIs and builds executive-ready dashboards automatically.
        </p>
      </motion.div>

      {/* ------------------------------ dropzone ------------------------------ */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.5 }}
        className="mt-7"
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
            dragOver
              ? "border-accent-500 bg-accent-500/8 shadow-glow"
              : "border-strong bg-surface hover:border-accent-500/60 hover:bg-surface-2"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.xml,.zip"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: "radial-gradient(600px 200px at 50% 0%, rgba(59,130,246,.08), transparent 70%)" }}
          />
          <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/12 text-accent-400">
            {parsing ? <Loader2 size={26} className="animate-spin" /> : <UploadCloud size={26} />}
          </div>
          <h3 className="mt-4 text-[16px] font-bold text-primary">
            {parsing ? "Parsing and profiling file…" : dragOver ? "Release to analyze" : "Drag & drop your dataset here"}
          </h3>
          <p className="mt-1 text-[12.5px] text-muted">or click to browse · select multiple files at once · up to 250K rows each, in-browser</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {FORMATS.map((f) => (
              <span key={f.label} className="flex items-center gap-1.5 rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-secondary">
                <f.icon size={12} className="text-accent-400" /> {f.label}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-critical-500/40 bg-critical-500/10 px-4 py-2.5 text-[12.5px] text-critical-500">
            <AlertCircle size={15} />
            {error}
          </div>
        )}
      </motion.div>

      {/* --------------------------- sample datasets --------------------------- */}
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.5 }} className="mt-9">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-primary">Try a sample dataset</h2>
          <span className="text-[11px] text-muted">Synthetic but operationally realistic — generated locally</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SAMPLES.map((s) => (
            <div key={s.id} className="panel flex flex-col p-4 transition-all hover:border-accent-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-bold leading-snug text-primary">{s.name}</h3>
                <Database size={15} className="mt-0.5 shrink-0 text-accent-400" />
              </div>
              <p className="mt-1.5 flex-1 text-[11.5px] leading-relaxed text-secondary">{s.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.tags.map((t) => (
                  <span key={t} className="rounded-md bg-inset px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted">
                    {t}
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-muted">{s.approxRows}</span>
              </div>
              <button
                onClick={() => void loadSample(s.id)}
                disabled={loadingSample !== null}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent-500/12 py-2 text-[12px] font-bold text-accent-400 transition-all hover:bg-accent-500 hover:text-white disabled:opacity-50"
              >
                {loadingSample === s.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {loadingSample === s.id ? "Generating…" : "Load & analyze"}
              </button>
            </div>
          ))}
        </div>
      </motion.section>

      {/* --------------------------- recent datasets --------------------------- */}
      {datasets.length > 0 && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-9">
          <h2 className="text-[15px] font-bold text-primary">Session datasets</h2>
          <p className="text-[11px] text-muted">Held in memory for this session — connect a database for persistent storage.</p>
          <div className="mt-3 space-y-2">
            {datasets.map((d) => {
              const a = analyses[d.id];
              const isActive = d.id === activeId;
              return (
                <div
                  key={d.id}
                  className={`panel flex items-center gap-4 px-4 py-3 transition-all ${isActive ? "border-accent-500/50" : ""}`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a ? "bg-success-500/12 text-success-500" : "bg-inset text-muted"}`}>
                    {a ? <CheckCircle2 size={17} /> : <Loader2 size={17} className="animate-spin" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-primary">{d.name}</div>
                    <div className="text-[11px] text-muted">
                      {fmtNum(d.rowCount, 0)} rows · {d.columns.length} cols · {d.sizeBytes ? `${fmtBytes(d.sizeBytes)} · ` : ""}
                      {fmtTimeAgo(d.uploadedAt)}
                      {a && <span className="ml-2 text-accent-400">{a.domains[0]?.domain} {a.domains[0]?.confidence}%</span>}
                    </div>
                  </div>
                  {a && (
                    <button
                      onClick={() => {
                        selectDataset(d.id);
                        navigate("/workspace");
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-accent-500/12 px-3 py-1.5 text-[11.5px] font-bold text-accent-400 transition-all hover:bg-accent-500 hover:text-white"
                    >
                      Open <ArrowRight size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => removeDataset(d.id)}
                    title="Remove from session"
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-critical-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ------------------------------ journey ------------------------------- */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-10 mb-6">
        <div className="panel relative overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(120deg, rgba(59,130,246,.05), transparent 50%)" }} />
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted">From file to insight — under 60 seconds</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {JOURNEY.map((j, i) => (
              <div key={j.title} className="relative">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500/12 text-accent-400">
                    <j.icon size={15} />
                  </div>
                  <span className="text-[10px] font-bold text-muted">0{i + 1}</span>
                </div>
                <div className="mt-2 text-[12.5px] font-bold text-primary">{j.title}</div>
                <div className="text-[11px] leading-snug text-muted">{j.text}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  );
}
