import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/format";
import { ROLES } from "@/lib/constants";
import { applyFilters, runPipeline } from "@/agents/orchestrator";
import { answerQuery } from "@/agents/chatAssistant";
import { applyWidgetActions, describeAction, parseActions } from "@/agents/dashboardActions";
import { planActions } from "@/llm/actionAssist";
import { DEFAULT_OLLAMA_URL, chatOnce, pickDefaultModel, pingOllama, streamChat, type LlmChatMessage } from "@/llm/ollamaClient";
import { buildChatSystemPrompt, buildNarrativePrompt, parseNarrativeJson } from "@/llm/contextBuilder";
import { runMappingAssist } from "@/llm/mappingAssist";
import type {
  AgentProgressEvent,
  AgentStatus,
  AnalysisResult,
  AuditEntry,
  ChatMessage,
  DashboardAction,
  Dataset,
  FilterState,
  LlmState,
  PersonaId,
  RoleId,
  UserProfile,
  WidgetSpec,
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
  chatMode: "chat" | "dashboard";
  setChatMode: (m: "chat" | "dashboard") => void;
  ask: (q: string) => Promise<ChatMessage | null>;
  askDashboard: (q: string) => Promise<ChatMessage | null>;
  clearChat: () => void;
  stopGeneration: () => void;

  /* chat-driven dashboard customization */
  customWidgets: Record<string, WidgetSpec[]>;
  applyDashboardActions: (actions: DashboardAction[]) => { applied: string[]; failed: string[] };
  applySuggestedActions: (messageId: string) => void;
  resetDashboardLayout: () => void;

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
  ingestAndAnalyzeMany: (datasets: Dataset[]) => Promise<void>;
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

        // smart offer: if the question also reads as a dashboard command, let
        // the user apply it from the reply
        const suggested = parseActions(q, a, widgetsOf(get()), techValuesOf(get()));
        const suggestedActions = suggested.length > 0 ? suggested : undefined;

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
            suggestedActions,
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
          suggestedActions,
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
      chatMode: "chat",
      setChatMode: (m) => set({ chatMode: m }),
      stopGeneration: () => {
        chatAbort?.abort();
      },

      /* ---------------- chat-driven dashboard actions ---------------- */
      customWidgets: {},

      askDashboard: async (q) => {
        const a = get().viewAnalysis;
        const userMsg: ChatMessage = { id: uid("msg"), role: "user", text: q, at: Date.now() };
        set({ chat: [...get().chat, userMsg], chatBusy: true });
        get().logAudit("AI_DASHBOARD_REQUEST", q.slice(0, 120));

        const finish = (reply: Omit<ChatMessage, "id" | "role" | "at">): ChatMessage => {
          const msg: ChatMessage = { id: uid("msg"), role: "assistant", at: Date.now(), ...reply };
          set({ chat: [...get().chat, msg], chatBusy: false });
          return msg;
        };

        if (!a) {
          return finish({ text: "Upload a dataset first — once dashboards exist I can modify them from chat." });
        }

        await new Promise((r) => setTimeout(r, 350));
        let actions = parseActions(q, a, widgetsOf(get()), techValuesOf(get()));
        let engine = "rules";
        const llm = get().llm;
        if (actions.length === 0 && llm.status === "connected" && llm.model) {
          // short conversation context so follow-ups ("for msan please") resolve
          const tail = get()
            .chat.slice(-5, -1)
            .map((m) => (m.role === "user" ? `User asked: ${m.text.slice(0, 140)}` : m.applied?.length ? `Applied: ${m.applied.join("; ").slice(0, 140)}` : null))
            .filter(Boolean)
            .join("\n");
          actions = await planActions(q, a, widgetsOf(get()), { baseUrl: llm.baseUrl, model: llm.model }, tail || undefined);
          engine = llm.model;
        }
        if (actions.length === 0) {
          const det = answerQuery(q, a);
          return finish({
            text: `I couldn't map that to a dashboard change — try things like "focus on ${a.regionStats[0]?.region ?? "a region"}", "add a top 20 table", "remove the heatmap", or "reset dashboard". Here's the answer instead:\n\n${det.text}`,
            chart: det.chart,
            engine: "rules",
          });
        }
        const res = get().applyDashboardActions(actions);
        const ok = res.applied.length > 0;
        return finish({
          text: ok ? "Done — the dashboard has been updated." : "I understood the request but couldn't apply it.",
          applied: res.applied,
          failed: res.failed,
          engine,
        });
      },

      applyDashboardActions: (actions) => {
        const applied: string[] = [];
        const failed: string[] = [];
        const { viewAnalysis, activeDatasetId, analyses } = get();
        if (!viewAnalysis || !activeDatasetId) return { applied, failed };

        /* 1 — persona switches first so widget ops hit the right tab */
        for (const a of actions) {
          if (a.kind === "switch-persona") {
            if (viewAnalysis.dashboards.some((d) => d.persona === a.persona)) {
              get().setPersona(a.persona);
              applied.push(describeAction(a));
            } else failed.push(`No "${a.persona}" dashboard for this dataset`);
          }
        }

        /* 2 — reset layout */
        if (actions.some((a) => a.kind === "reset-dashboard")) {
          const key = widgetKey(get());
          const cw = { ...get().customWidgets };
          if (cw[key]) {
            delete cw[key];
            set({ customWidgets: cw });
            applied.push("Reset the dashboard to the AI-generated layout");
          } else {
            applied.push("Dashboard is already the AI-generated layout");
          }
        }

        /* 3 — widget + KPI-card mutations on the active persona */
        const widgetActions = actions.filter(
          (a) =>
            a.kind === "add-widget" ||
            a.kind === "remove-widget" ||
            a.kind === "resize-widget" ||
            a.kind === "set-limit" ||
            a.kind === "remove-kpi" ||
            a.kind === "add-kpi"
        );
        if (widgetActions.length > 0) {
          const key = widgetKey(get());
          const res = applyWidgetActions(widgetsOf(get()), widgetActions, viewAnalysis.kpis);
          if (res.changed) set({ customWidgets: { ...get().customWidgets, [key]: res.widgets } });
          applied.push(...res.applied);
          failed.push(...res.failed);
        }

        /* 4 — filters merged into a single re-analysis */
        const patch: Partial<FilterState> = {};
        let touched = false;
        const full = analyses[activeDatasetId];
        for (const a of actions) {
          switch (a.kind) {
            case "filter-regions":
              patch.regions = a.regions;
              touched = true;
              applied.push(describeAction(a));
              break;
            case "filter-dates":
              if (a.clear) {
                patch.dateStart = null;
                patch.dateEnd = null;
                touched = true;
                applied.push(describeAction(a));
              } else if (full?.timeRange && a.lastDays) {
                patch.dateEnd = full.timeRange.end;
                patch.dateStart = full.timeRange.end - a.lastDays * 864e5;
                touched = true;
                applied.push(describeAction(a));
              } else {
                failed.push("This dataset has no time dimension to filter");
              }
              break;
            case "filter-search":
              patch.search = a.search;
              touched = true;
              applied.push(describeAction(a));
              break;
            case "filter-technology":
              patch.technology = a.technology;
              touched = true;
              applied.push(describeAction(a));
              break;
            case "reset-filters":
              Object.assign(patch, { ...EMPTY_FILTERS });
              touched = true;
              applied.push(describeAction(a));
              break;
            default:
              break;
          }
        }
        if (touched) get().setFilters(patch);

        if (applied.length > 0) get().logAudit("DASHBOARD_ACTION", applied.join(" · ").slice(0, 200));
        return { applied, failed };
      },

      applySuggestedActions: (messageId) => {
        const msg = get().chat.find((m) => m.id === messageId);
        if (!msg?.suggestedActions?.length) return;
        const res = get().applyDashboardActions(msg.suggestedActions);
        set({
          chat: [
            ...get().chat.map((m) => (m.id === messageId ? { ...m, suggestedActions: undefined } : m)),
            {
              id: uid("msg"),
              role: "assistant" as const,
              text: res.applied.length > 0 ? "Applied to the dashboard." : "Couldn't apply those changes.",
              applied: res.applied,
              failed: res.failed,
              at: Date.now(),
              engine: "rules",
            },
          ],
        });
      },

      resetDashboardLayout: () => {
        const key = widgetKey(get());
        const cw = { ...get().customWidgets };
        if (cw[key]) {
          delete cw[key];
          set({ customWidgets: cw });
          get().logAudit("DASHBOARD_ACTION", "Layout reset to AI-generated");
        }
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

      ingestAndAnalyzeMany: async (datasets) => {
        if (datasets.length === 0) return;
        // first file gets the theatrical overlay; the rest analyze in the
        // background and join the session list as they finish
        await get().ingestAndAnalyze(datasets[0]);
        const llm = get().llm;
        for (let i = 1; i < datasets.length; i++) {
          const ds = datasets[i];
          set({ datasets: [...get().datasets.filter((d) => d.id !== ds.id), ds].slice(-8) });
          get().logAudit("UPLOAD", `${ds.name} (${ds.rowCount.toLocaleString()} rows, ${ds.fileType})`);
          try {
            const analysis = await runPipeline(ds, {
              theatrical: false,
              assist:
                llm.status === "connected" && llm.model
                  ? (d, profile) => runMappingAssist(d, profile, { baseUrl: llm.baseUrl, model: llm.model! })
                  : undefined,
              onDatasetTransformed: (transformed) => {
                set({ datasets: get().datasets.map((d) => (d.id === ds.id ? { ...transformed, id: ds.id, name: ds.name } : d)) });
              },
            });
            set({ analyses: { ...get().analyses, [ds.id]: analysis } });
            get().logAudit("ANALYZE", `${ds.name}: ${analysis.domains[0]?.domain} ${analysis.domains[0]?.confidence}% · ${analysis.kpis.length} KPIs`);
            void get().enhanceStory(ds.id);
          } catch {
            // skip a file that fails; the others still land
          }
        }
      },

      selectDataset: (id) => {
        const a = get().analyses[id];
        if (a) {
          set({ activeDatasetId: id, viewAnalysis: a, filters: { ...EMPTY_FILTERS }, chat: [] });
        }
      },

      removeDataset: (id) => {
        const { datasets, analyses, activeDatasetId, customWidgets } = get();
        const rest = datasets.filter((d) => d.id !== id);
        const a = { ...analyses };
        delete a[id];
        const cw = Object.fromEntries(Object.entries(customWidgets).filter(([k]) => !k.startsWith(`${id}:`)));
        set({
          datasets: rest,
          analyses: a,
          customWidgets: cw,
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

/** Key for per-dataset, per-persona widget overrides. */
function widgetKey(s: Pick<AppState, "activeDatasetId" | "persona">): string {
  return `${s.activeDatasetId}:${s.persona}`;
}

/** The widget list currently shown: custom override or the generated layout. */
export function widgetsOf(s: Pick<AppState, "viewAnalysis" | "activeDatasetId" | "persona" | "customWidgets">): WidgetSpec[] {
  const a = s.viewAnalysis;
  if (!a) return [];
  const override = s.customWidgets[widgetKey(s)];
  if (override) return override;
  return a.dashboards.find((d) => d.persona === s.persona)?.widgets ?? a.dashboards[0]?.widgets ?? [];
}

/** Distinct technology values for the active dataset (filter vocabulary). */
function techValuesOf(s: Pick<AppState, "datasets" | "activeDatasetId" | "viewAnalysis">): string[] {
  const ds = s.datasets.find((d) => d.id === s.activeDatasetId);
  const col = s.viewAnalysis?.mapping.technology;
  if (!ds || !col) return [];
  const out = new Set<string>();
  for (const r of ds.rows) {
    const v = r[col];
    if (v !== null && v !== undefined) out.add(String(v));
    if (out.size > 12) break;
  }
  return [...out];
}

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
