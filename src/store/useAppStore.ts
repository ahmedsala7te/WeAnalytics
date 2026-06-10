import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/format";
import { ROLES } from "@/lib/constants";
import { applyFilters, runPipeline } from "@/agents/orchestrator";
import { answerQuery } from "@/agents/chatAssistant";
import { DEFAULT_OLLAMA_URL, chatOnce, pickDefaultModel, pingOllama, streamChat, type LlmChatMessage } from "@/llm/ollamaClient";
import { buildChatSystemPrompt, buildNarrativePrompt, parseNarrativeJson } from "@/llm/contextBuilder";
import { runMappingAssist } from "@/llm/mappingAssist";
import type {
  AgentProgressEvent,
  AgentStatus,
  AnalysisResult,
  AuditEntry,
  ChatMessage,
  Dataset,
  FilterState,
  LlmState,
  PersonaId,
  RoleId,
  UserProfile,
} from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";

/** AbortController for the in-flight chat stream (module scope — not persisted). */
let chatAbort: AbortController | null = null;

interface AppState {
  /* theme */
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;

  /* auth */
  user: UserProfile | null;
  login: (name: string, role: RoleId) => void;
  logout: () => void;

  /* data */
  datasets: Dataset[];
  activeDatasetId: string | null;
  analyses: Record<string, AnalysisResult>;
  viewAnalysis: AnalysisResult | null;
  viewLoading: boolean;

  /* pipeline */
  pipelineRunning: boolean;
  pipelineVisible: boolean;
  agentStatus: Record<string, { status: AgentStatus; note?: string }>;
  hidePipeline: () => void;

  /* filters + persona */
  filters: FilterState;
  persona: PersonaId;
  setPersona: (p: PersonaId) => void;
  setFilters: (f: Partial<FilterState>) => void;
  resetFilters: () => void;

  /* chat */
  chat: ChatMessage[];
  chatBusy: boolean;
  ask: (q: string) => Promise<ChatMessage | null>;
  clearChat: () => void;
  stopGeneration: () => void;

  /* local LLM (Ollama) */
  llm: LlmState;
  connectLlm: (baseUrl?: string, opts?: { silent?: boolean }) => Promise<void>;
  disconnectLlm: () => void;
  setLlmModel: (model: string) => void;
  setNarrativeEnabled: (on: boolean) => void;
  enhanceStory: (datasetId: string) => Promise<void>;

  /* audit */
  audit: AuditEntry[];
  logAudit: (action: string, detail: string) => void;

  /* orchestration */
  ingestAndAnalyze: (dataset: Dataset) => Promise<void>;
  selectDataset: (id: string) => void;
  removeDataset: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      setTheme: (t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
        set({ theme: t });
      },

      user: null,
      login: (name, role) => {
        const profile: UserProfile = { name, role, loginAt: Date.now() };
        const def = ROLES.find((r) => r.id === role)?.defaultPersona ?? "executive";
        set({ user: profile, persona: def });
        get().logAudit("LOGIN", `${name} signed in as ${role.toUpperCase()} (mock SSO)`);
      },
      logout: () => {
        const u = get().user;
        if (u) get().logAudit("LOGOUT", `${u.name} signed out`);
        set({ user: null });
      },

      datasets: [],
      activeDatasetId: null,
      analyses: {},
      viewAnalysis: null,
      viewLoading: false,

      pipelineRunning: false,
      pipelineVisible: false,
      agentStatus: {},
      hidePipeline: () => set({ pipelineVisible: false }),

      filters: { ...EMPTY_FILTERS },
      persona: "executive",
      setPersona: (p) => set({ persona: p }),

      setFilters: (f) => {
        const filters = { ...get().filters, ...f };
        set({ filters });
        void refreshView(set, get, filters);
      },
      resetFilters: () => {
        const filters = { ...EMPTY_FILTERS };
        set({ filters });
        void refreshView(set, get, filters);
      },

      chat: [],
      chatBusy: false,
      ask: async (q) => {
        const a = get().viewAnalysis;
        const userMsg: ChatMessage = { id: uid("msg"), role: "user", text: q, at: Date.now() };
        set({ chat: [...get().chat, userMsg], chatBusy: true });
        get().logAudit("AI_QUERY", q.slice(0, 120));

        if (!a) {
          const reply: ChatMessage = {
            id: uid("msg"),
            role: "assistant",
            text: "Upload a dataset first — once the analysis pipeline finishes I can answer questions about it.",
            at: Date.now(),
          };
          set({ chat: [...get().chat, reply], chatBusy: false });
          return reply;
        }

        // Deterministic engine always runs: supplies charts, export actions and the fallback text.
        const det = answerQuery(q, a);
        const llm = get().llm;
        const useLlm = llm.status === "connected" && !!llm.model && !det.action;

        if (!useLlm) {
          await new Promise((r) => setTimeout(r, 420 + Math.random() * 400));
          const reply: ChatMessage = {
            id: uid("msg"),
            role: "assistant",
            text: det.text,
            chart: det.chart,
            action: det.action,
            at: Date.now(),
            engine: "rules",
          };
          set({ chat: [...get().chat, reply], chatBusy: false });
          return reply;
        }

        // LLM path: stream tokens from Ollama, grounded in the analysis digest.
        const replyId = uid("msg");
        const reply: ChatMessage = {
          id: replyId,
          role: "assistant",
          text: "",
          chart: det.chart,
          at: Date.now(),
          streaming: true,
          engine: llm.model!,
        };
        set({ chat: [...get().chat, reply] });

        const patch = (text: string, streaming: boolean, engine?: string) =>
          set({
            chat: get().chat.map((m) => (m.id === replyId ? { ...m, text, streaming, ...(engine ? { engine } : {}) } : m)),
          });

        const history: LlmChatMessage[] = get()
          .chat.filter((m) => m.id !== replyId && m.text.trim().length > 0)
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.text.slice(0, 1600) }));

        chatAbort = new AbortController();
        let lastFlush = 0;
        try {
          const final = await streamChat({
            baseUrl: llm.baseUrl,
            model: llm.model!,
            messages: [{ role: "system", content: buildChatSystemPrompt(a) }, ...history],
            signal: chatAbort.signal,
            temperature: 0.4,
            maxTokens: 700,
            onToken: (full) => {
              const now = Date.now();
              if (now - lastFlush > 90) {
                lastFlush = now;
                patch(full, true);
              }
            },
          });
          patch(final.trim() || det.text, false);
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === "AbortError";
          const current = get().chat.find((m) => m.id === replyId);
          if (aborted && current?.text) {
            patch(current.text + " …(stopped)", false);
          } else {
            // graceful fallback to the deterministic answer
            patch(det.text, false, "rules");
          }
        } finally {
          chatAbort = null;
          set({ chatBusy: false });
        }
        return get().chat.find((m) => m.id === replyId) ?? null;
      },
      clearChat: () => set({ chat: [] }),
      stopGeneration: () => {
        chatAbort?.abort();
      },

      /* ------------------------------ local LLM ------------------------------ */
      llm: {
        baseUrl: DEFAULT_OLLAMA_URL,
        model: null,
        status: "off",
        models: [],
        narrativeEnabled: true,
        enhancing: false,
      },
      connectLlm: async (baseUrl, opts) => {
        const url = (baseUrl ?? get().llm.baseUrl).trim() || DEFAULT_OLLAMA_URL;
        set({ llm: { ...get().llm, baseUrl: url, status: "connecting", error: undefined } });
        try {
          const models = await pingOllama(url);
          const current = get().llm.model;
          const model = current && models.some((m) => m.name === current) ? current : pickDefaultModel(models);
          if (models.length === 0) {
            set({
              llm: { ...get().llm, status: "error", models, model: null, error: "Ollama is running but has no models. Pull one, e.g.: ollama pull llama3.2:3b" },
            });
            return;
          }
          set({ llm: { ...get().llm, status: "connected", models, model, error: undefined } });
          get().logAudit("LLM_CONNECT", `Ollama @ ${url} · ${models.length} models · using ${model}`);
        } catch (e) {
          set({
            llm: {
              ...get().llm,
              status: opts?.silent ? "off" : "error",
              models: [],
              error: opts?.silent ? undefined : e instanceof Error ? `Cannot reach Ollama at ${url} — is it running?` : "Cannot reach Ollama",
            },
          });
        }
      },
      disconnectLlm: () => {
        chatAbort?.abort();
        set({ llm: { ...get().llm, status: "off", models: [], error: undefined, enhancing: false } });
        get().logAudit("LLM_DISCONNECT", "Local LLM disabled — deterministic engine active");
      },
      setLlmModel: (model) => {
        set({ llm: { ...get().llm, model } });
        get().logAudit("LLM_MODEL", model);
      },
      setNarrativeEnabled: (on) => set({ llm: { ...get().llm, narrativeEnabled: on } }),

      enhanceStory: async (datasetId) => {
        const { llm, analyses } = get();
        if (llm.status !== "connected" || !llm.model || !llm.narrativeEnabled) return;
        const a = analyses[datasetId];
        if (!a) return;
        set({ llm: { ...get().llm, enhancing: true } });
        try {
          const { system, user } = buildNarrativePrompt(a);
          const raw = await chatOnce({
            baseUrl: llm.baseUrl,
            model: llm.model,
            json: true,
            temperature: 0.35,
            maxTokens: 900,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });
          const parsed = parseNarrativeJson(raw);
          if (parsed?.headline && parsed.summary) {
            const story = {
              ...a.story,
              headline: parsed.headline,
              summary: parsed.summary,
              keyInsights: parsed.keyInsights?.length ? parsed.keyInsights : a.story.keyInsights,
              risks: parsed.risks?.length ? parsed.risks : a.story.risks,
              recommendations: parsed.recommendations?.length ? parsed.recommendations : a.story.recommendations,
              generatedBy: llm.model,
            };
            const cur = get();
            const updated = { ...a, story };
            set({
              analyses: { ...cur.analyses, [datasetId]: updated },
              viewAnalysis:
                cur.viewAnalysis && cur.viewAnalysis.datasetId === datasetId && cur.viewAnalysis.generatedAt === a.generatedAt
                  ? { ...cur.viewAnalysis, story }
                  : cur.viewAnalysis,
            });
            get().logAudit("LLM_NARRATIVE", `${llm.model} rewrote the executive narrative`);
          }
        } catch {
          // template narrative stays — LLM enhancement is best-effort
        } finally {
          set({ llm: { ...get().llm, enhancing: false } });
        }
      },

      audit: [],
      logAudit: (action, detail) => {
        const u = get().user;
        const entry: AuditEntry = {
          id: uid("aud"),
          at: Date.now(),
          user: u?.name ?? "anonymous",
          role: u?.role ?? "-",
          action,
          detail,
        };
        set({ audit: [entry, ...get().audit].slice(0, 250) });
      },

      ingestAndAnalyze: async (dataset) => {
        const init: Record<string, { status: AgentStatus; note?: string }> = {};
        set({
          datasets: [dataset, ...get().datasets.filter((d) => d.id !== dataset.id)].slice(0, 8),
          activeDatasetId: dataset.id,
          pipelineRunning: true,
          pipelineVisible: true,
          agentStatus: init,
          chat: [],
        });
        get().logAudit("UPLOAD", `${dataset.name} (${dataset.rowCount.toLocaleString()} rows, ${dataset.fileType})`);
        const onProgress = (e: AgentProgressEvent) =>
          set({ agentStatus: { ...get().agentStatus, [e.agentKey]: { status: e.status, note: e.note } } });
        try {
          const llm = get().llm;
          const analysis = await runPipeline(dataset, {
            onProgress,
            theatrical: true,
            // LLM data-understanding agent (only consulted when heuristics are weak)
            assist:
              llm.status === "connected" && llm.model
                ? (ds, profile) => runMappingAssist(ds, profile, { baseUrl: llm.baseUrl, model: llm.model! })
                : undefined,
            onDatasetTransformed: (transformed) => {
              // keep the reshaped dataset so filters re-slice the same table
              set({ datasets: get().datasets.map((d) => (d.id === dataset.id ? { ...transformed, id: dataset.id, name: dataset.name } : d)) });
              get().logAudit("LLM_TRANSFORM", `${dataset.name} reshaped to ${transformed.rowCount.toLocaleString()} rows`);
            },
          });
          set({
            analyses: { ...get().analyses, [dataset.id]: analysis },
            viewAnalysis: analysis,
            pipelineRunning: false,
            filters: { ...EMPTY_FILTERS },
          });
          get().logAudit("ANALYZE", `${analysis.domains[0]?.domain} ${analysis.domains[0]?.confidence}% · ${analysis.kpis.length} KPIs · health ${analysis.healthScore.toFixed(1)}`);
          // Agent 10 LLM enhancement runs in the background — dashboards are live immediately
          void get().enhanceStory(dataset.id);
        } catch (err) {
          set({ pipelineRunning: false, pipelineVisible: false });
          throw err;
        }
      },

      selectDataset: (id) => {
        const a = get().analyses[id];
        if (a) {
          set({ activeDatasetId: id, viewAnalysis: a, filters: { ...EMPTY_FILTERS }, chat: [] });
        }
      },

      removeDataset: (id) => {
        const { datasets, analyses, activeDatasetId } = get();
        const rest = datasets.filter((d) => d.id !== id);
        const a = { ...analyses };
        delete a[id];
        set({
          datasets: rest,
          analyses: a,
          ...(activeDatasetId === id
            ? { activeDatasetId: rest[0]?.id ?? null, viewAnalysis: rest[0] ? (a[rest[0].id] ?? null) : null }
            : {}),
        });
      },
    }),
    {
      name: "netpulse-store",
      partialize: (s) => ({
        theme: s.theme,
        user: s.user,
        audit: s.audit,
        llm: {
          baseUrl: s.llm.baseUrl,
          model: s.llm.model,
          narrativeEnabled: s.llm.narrativeEnabled,
          status: "off" as const,
          models: [],
          enhancing: false,
        },
      }),
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.classList.toggle("dark", state.theme === "dark");
      },
    }
  )
);

async function refreshView(
  set: (s: Partial<AppState>) => void,
  get: () => AppState,
  filters: FilterState
) {
  const { activeDatasetId, datasets, analyses } = get();
  if (!activeDatasetId) return;
  const dataset = datasets.find((d) => d.id === activeDatasetId);
  const full = analyses[activeDatasetId];
  if (!dataset || !full) return;
  set({ viewLoading: true });
  try {
    const noFilters =
      filters.dateStart === null &&
      filters.dateEnd === null &&
      filters.regions.length === 0 &&
      !filters.technology &&
      !filters.search.trim();
    if (noFilters) {
      set({ viewAnalysis: full, viewLoading: false });
      return;
    }
    const filtered = applyFilters(dataset, filters, full.mapping);
    if (filtered.rowCount === 0) {
      set({ viewAnalysis: full, viewLoading: false });
      return;
    }
    const analysis = await runPipeline(filtered, { theatrical: false });
    set({ viewAnalysis: analysis, viewLoading: false });
  } catch {
    set({ viewLoading: false });
  }
}
