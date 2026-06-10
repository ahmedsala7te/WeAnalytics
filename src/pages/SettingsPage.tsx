import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Check, Fingerprint, KeyRound, Loader2, Moon, Plug, RefreshCw, ScrollText, ShieldCheck, Sun, Users, Zap } from "lucide-react";
import { ROLES } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

const RBAC_FEATURES = [
  { feature: "View dashboards", roles: ["cto", "noc", "capacity", "performance", "assurance", "admin"] },
  { feature: "Upload datasets", roles: ["noc", "capacity", "performance", "assurance", "admin"] },
  { feature: "Export reports", roles: ["cto", "noc", "capacity", "performance", "assurance", "admin"] },
  { feature: "AI Copilot", roles: ["cto", "noc", "capacity", "performance", "assurance", "admin"] },
  { feature: "Configure connectors", roles: ["admin"] },
  { feature: "View audit log", roles: ["cto", "admin"] },
];

const INTEGRATIONS = [
  { icon: Fingerprint, name: "Single Sign-On (SAML / OIDC)", detail: "Production: federate with the corporate IdP. Demo: local role simulation.", state: "Integration point" },
  { icon: Users, name: "Active Directory / LDAP", detail: "Map AD groups to platform roles for automatic provisioning.", state: "Integration point" },
  { icon: KeyRound, name: "Encryption", detail: "TLS in transit; in this demo all processing is local to the browser — data never leaves the machine.", state: "Local-only mode" },
  { icon: ShieldCheck, name: "Multi-tenant isolation", detail: "Per-OpCo workspaces with row-level security at the connector layer.", state: "Integration point" },
];

export function SettingsPage() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const user = useAppStore((s) => s.user);
  const audit = useAppStore((s) => s.audit);
  const llm = useAppStore((s) => s.llm);
  const connectLlm = useAppStore((s) => s.connectLlm);
  const disconnectLlm = useAppStore((s) => s.disconnectLlm);
  const setLlmModel = useAppStore((s) => s.setLlmModel);
  const setNarrativeEnabled = useAppStore((s) => s.setNarrativeEnabled);
  const [urlDraft, setUrlDraft] = useState(llm.baseUrl);

  const canSeeAudit = user?.role === "admin" || user?.role === "cto";

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-400">Platform</p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-primary">Settings & Governance</h1>
      </motion.div>

      {/* local LLM */}
      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Bot size={16} className="text-accent-400" />
          <h2 className="text-[14px] font-bold text-primary">Local AI — Ollama</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              llm.status === "connected"
                ? "bg-success-500/12 text-success-500"
                : llm.status === "connecting"
                  ? "bg-warning-500/12 text-warning-500"
                  : llm.status === "error"
                    ? "bg-critical-500/12 text-critical-500"
                    : "bg-inset text-muted"
            }`}
          >
            {llm.status === "connected" ? "Connected" : llm.status === "connecting" ? "Connecting…" : llm.status === "error" ? "Error" : "Off"}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          When connected, Agent 12 (Chat Assistant) becomes a conversational LLM grounded in the analysis digest, Agent 10
          (Executive Storytelling) rewrites the narrative, and a Data Understanding agent remaps/reshapes uploads the heuristics
          can't parse (foreign-language headers, wide multi-period reports) — it automatically uses the strongest installed model
          for that one call. All numeric agents stay deterministic — the LLM never invents numbers. Everything runs on this
          machine; nothing leaves it.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Ollama server URL</label>
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="http://localhost:11434"
              className="mt-1 w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-[12.5px] text-primary placeholder:text-muted focus:border-accent-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => void connectLlm(urlDraft)}
            disabled={llm.status === "connecting"}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-glow transition-all hover:bg-accent-400 disabled:opacity-50"
          >
            {llm.status === "connecting" ? <Loader2 size={14} className="animate-spin" /> : llm.status === "connected" ? <RefreshCw size={14} /> : <Plug size={14} />}
            {llm.status === "connected" ? "Reconnect" : "Connect"}
          </button>
          {llm.status === "connected" && (
            <button
              onClick={disconnectLlm}
              className="rounded-lg border border-subtle px-4 py-2 text-[12.5px] font-semibold text-secondary transition-colors hover:border-critical-500/50 hover:text-critical-500"
            >
              Disconnect
            </button>
          )}
        </div>

        {llm.error && (
          <div className="mt-3 rounded-xl border border-critical-500/40 bg-critical-500/10 px-3.5 py-2.5 text-[12px] text-critical-500">
            {llm.error}
          </div>
        )}

        {llm.status === "connected" && (
          <>
            <div className="mt-4">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted">Model ({llm.models.length} installed)</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {llm.models.map((m) => {
                  const active = llm.model === m.name;
                  const big = m.sizeGb > 6;
                  return (
                    <button
                      key={m.name}
                      onClick={() => setLlmModel(m.name)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                        active ? "border-accent-500 bg-accent-500/10 shadow-glow" : "border-subtle bg-surface-2 hover:border-strong"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[12.5px] font-bold ${active ? "text-accent-400" : "text-primary"}`}>{m.name}</div>
                        <div className="text-[10.5px] text-muted">
                          {m.paramSize ?? "?"} · {m.sizeGb} GB{big ? " · slow on CPU-only machines" : ""}
                        </div>
                      </div>
                      {active && <Check size={15} className="shrink-0 text-accent-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-3">
              <button
                role="switch"
                aria-checked={llm.narrativeEnabled}
                onClick={() => setNarrativeEnabled(!llm.narrativeEnabled)}
                className={`relative h-5 w-9 rounded-full transition-colors ${llm.narrativeEnabled ? "bg-accent-500" : "bg-inset"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${llm.narrativeEnabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <span className="text-[12.5px] font-semibold text-primary">LLM executive narrative</span>
              <span className="text-[11px] text-muted">— rewrite the story after each analysis (runs in background)</span>
            </label>
          </>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-info-500/30 bg-info-500/8 p-3 text-[11.5px] leading-relaxed">
          <Zap size={13} className="mt-0.5 shrink-0 text-info-500" />
          <span className="text-secondary">
            This machine (i7-1165G7, 16 GB RAM, no dedicated GPU) runs Ollama on CPU — models in the <strong>3–4B</strong> range respond
            fastest. Larger models like 14B work but stream slowly. Tip: <code className="rounded bg-inset px-1 font-mono text-[10.5px]">ollama pull llama3.2:3b</code> or{" "}
            <code className="rounded bg-inset px-1 font-mono text-[10.5px]">qwen2.5:3b-instruct</code> are ideal general-chat models for this hardware.
          </span>
        </div>
      </section>

      {/* appearance */}
      <section className="panel mt-6 p-5">
        <h2 className="text-[14px] font-bold text-primary">Appearance</h2>
        <p className="mt-0.5 text-[12px] text-muted">Dark mode is first-class — tuned for NOC wallboards and low-light operations rooms.</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setTheme("dark")}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12.5px] font-semibold transition-all ${
              theme === "dark" ? "border-accent-500 bg-accent-500/10 text-accent-400 shadow-glow" : "border-subtle text-secondary hover:border-strong"
            }`}
          >
            <Moon size={15} /> Dark (recommended)
          </button>
          <button
            onClick={() => setTheme("light")}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12.5px] font-semibold transition-all ${
              theme === "light" ? "border-accent-500 bg-accent-500/10 text-accent-400 shadow-glow" : "border-subtle text-secondary hover:border-strong"
            }`}
          >
            <Sun size={15} /> Light
          </button>
        </div>
      </section>

      {/* security integrations */}
      <section className="panel mt-4 p-5">
        <h2 className="text-[14px] font-bold text-primary">Security & Identity</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {INTEGRATIONS.map((it) => (
            <div key={it.name} className="flex items-start gap-3 rounded-xl border border-subtle bg-surface-2 p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/12 text-accent-400">
                <it.icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-bold text-primary">{it.name}</span>
                  <span className="rounded-full bg-inset px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-muted">{it.state}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{it.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RBAC matrix */}
      <section className="panel mt-4 p-5">
        <h2 className="text-[14px] font-bold text-primary">Role-Based Access Control</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Signed in as <strong className="text-primary">{user?.name}</strong> ({ROLES.find((r) => r.id === user?.role)?.label}). Roles shape default dashboards and feature access.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-subtle">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Capability</th>
                {ROLES.map((r) => (
                  <th key={r.id} className={`px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider ${r.id === user?.role ? "text-accent-400" : "text-muted"}`}>
                    {r.label.split(" ")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RBAC_FEATURES.map((f) => (
                <tr key={f.feature} className="border-t border-subtle">
                  <td className="px-3 py-2 font-medium text-secondary">{f.feature}</td>
                  {ROLES.map((r) => (
                    <td key={r.id} className="px-3 py-2 text-center">
                      {f.roles.includes(r.id) ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-success-500" />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-inset" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* audit log */}
      {canSeeAudit && (
        <section className="panel mt-4 p-5">
          <div className="flex items-center gap-2">
            <ScrollText size={15} className="text-accent-400" />
            <h2 className="text-[14px] font-bold text-primary">Audit Log</h2>
            <span className="text-[11px] text-muted">({audit.length} events, stored locally)</span>
          </div>
          <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-subtle">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="bg-surface-2">
                  <th className="sticky top-0 bg-surface-2 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Time</th>
                  <th className="sticky top-0 bg-surface-2 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted">User</th>
                  <th className="sticky top-0 bg-surface-2 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Action</th>
                  <th className="sticky top-0 bg-surface-2 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted">No events recorded yet</td>
                  </tr>
                )}
                {audit.map((e) => (
                  <tr key={e.id} className="border-t border-subtle">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted">{fmtDateTime(e.at)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-secondary">{e.user} <span className="text-muted">({e.role})</span></td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="rounded-md bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-bold text-accent-400">{e.action}</span>
                    </td>
                    <td className="max-w-md truncate px-3 py-1.5 text-muted" title={e.detail}>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* about the AI */}
      <section className="panel mt-4 mb-8 p-5">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-accent-400" />
          <h2 className="text-[14px] font-bold text-primary">About the AI engine</h2>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-secondary">
          The 12-agent pipeline is a deterministic analytics engine: semantic column mapping, domain fingerprinting,
          threshold-based telecom intelligence, OLS regression, Holt double-exponential-smoothing forecasts, rolling
          z-score anomaly detection, Pareto root-cause analysis and template-grounded narrative generation. Every number
          in every insight is computed from the uploaded data — nothing is hallucinated, and everything runs offline in
          the browser. The architecture exposes a clean adapter seam where an LLM (e.g. Claude via the Anthropic API)
          can be plugged in for free-form narrative and conversational depth in connected environments.
        </p>
      </section>
    </div>
  );
}
