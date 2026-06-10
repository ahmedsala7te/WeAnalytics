import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, Bot, Database, LayoutDashboard, LogOut, Moon, Settings, Sun, UploadCloud } from "lucide-react";
import { ROLES } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";
import { AgentPipelineOverlay } from "@/components/AgentPipelineOverlay";

const NAV = [
  { to: "/", label: "Data Hub", icon: UploadCloud, end: true },
  { to: "/workspace", label: "Dashboards", icon: LayoutDashboard, end: false },
  { to: "/sources", label: "Connectors", icon: Database, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export function Shell() {
  const user = useAppStore((s) => s.user);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const logout = useAppStore((s) => s.logout);
  const analysis = useAppStore((s) => s.viewAnalysis);
  const llm = useAppStore((s) => s.llm);
  const connectLlm = useAppStore((s) => s.connectLlm);
  const navigate = useNavigate();
  const roleLabel = ROLES.find((r) => r.id === user?.role)?.label ?? "";

  // silently attach to a local Ollama server if one is running
  useEffect(() => {
    if (useAppStore.getState().llm.status === "off") {
      void connectLlm(undefined, { silent: true });
    }
  }, [connectLlm]);

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      {/* ------------------------------ sidebar ------------------------------ */}
      <aside className="flex w-[218px] shrink-0 flex-col border-r border-subtle bg-surface">
        {/* brand */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 shadow-glow dark:bg-navy-800">
            <Activity size={18} className="text-accent-400" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success-500 animate-pulse-dot" />
          </div>
          <div>
            <div className="text-[14px] font-extrabold tracking-tight text-primary">
              NetPulse
            </div>
            <div className="-mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
              Intelligence Hub
            </div>
          </div>
        </div>

        {/* nav */}
        <nav className="mt-2 flex-1 space-y-1 px-2.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                  isActive
                    ? "bg-accent-500/12 text-accent-400"
                    : "text-secondary hover:bg-surface-2 hover:text-primary"
                }`
              }
            >
              <n.icon size={16} />
              {n.label}
              {n.to === "/workspace" && analysis && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-success-500" title="Analysis ready" />
              )}
            </NavLink>
          ))}
        </nav>

        {/* status card */}
        {analysis && (
          <div className="mx-2.5 mb-2 rounded-xl border border-subtle bg-surface-2 p-3">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">Active analysis</div>
            <div className="mt-1 truncate text-[11.5px] font-semibold text-primary" title={analysis.datasetName}>
              {analysis.datasetName}
            </div>
            <div className="mt-0.5 text-[10.5px] text-muted">
              {analysis.domains[0]?.domain} · {analysis.kpis.length} KPIs
            </div>
          </div>
        )}

        {/* local LLM status */}
        <button
          onClick={() => navigate("/settings")}
          className="mx-2.5 mb-2 flex items-center gap-2 rounded-xl border border-subtle bg-surface-2 px-3 py-2 text-left transition-colors hover:border-strong"
          title={llm.status === "connected" ? `Ollama · ${llm.model}` : "Configure local AI in Settings"}
        >
          <Bot size={14} className={llm.status === "connected" ? "text-success-500" : "text-muted"} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Local AI</div>
            <div className={`truncate text-[10.5px] font-semibold ${llm.status === "connected" ? "text-success-500" : "text-muted"}`}>
              {llm.status === "connected" ? (llm.model ?? "connected") : llm.status === "connecting" ? "connecting…" : "rules engine"}
            </div>
          </div>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              llm.status === "connected" ? "bg-success-500 animate-pulse-dot" : llm.status === "connecting" ? "bg-warning-500 animate-pulse-dot" : "bg-inset"
            }`}
          />
        </button>

        {/* user / theme */}
        <div className="border-t border-subtle p-2.5">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[11px] font-bold text-accent-400">
              {user?.name?.slice(0, 1).toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-semibold text-primary">{user?.name}</div>
              <div className="truncate text-[10px] text-muted">{roleLabel}</div>
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title="Toggle theme"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-primary"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              title="Sign out"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-critical-500"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ------------------------------- content ------------------------------ */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <AgentPipelineOverlay />
    </div>
  );
}
