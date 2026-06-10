import { useState } from "react";
import { motion } from "framer-motion";
import { Cable, CheckCircle2, Database, FileUp, Globe, Network, Plug, Server, ShieldAlert, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

interface Connector {
  name: string;
  kind: "database" | "telecom" | "api" | "file";
  description: string;
  status: "available" | "configured";
}

const CONNECTORS: Connector[] = [
  { name: "File Upload", kind: "file", description: "Excel, CSV, JSON, XML and ZIP — fully operational in-browser", status: "configured" },
  { name: "Oracle", kind: "database", description: "OSS performance schemas via JDBC gateway", status: "available" },
  { name: "PostgreSQL", kind: "database", description: "Data warehouse and mediation stores", status: "available" },
  { name: "MySQL", kind: "database", description: "Inventory and provisioning databases", status: "available" },
  { name: "SQL Server", kind: "database", description: "Enterprise reporting databases", status: "available" },
  { name: "IBM DB2", kind: "database", description: "Legacy OSS platforms", status: "available" },
  { name: "Proviso / Tivoli Netcool Performance", kind: "telecom", description: "PM counters and KPI exports", status: "available" },
  { name: "IBM Netcool / OMNIbus", kind: "telecom", description: "Fault management event streams", status: "available" },
  { name: "Performance Management Systems", kind: "telecom", description: "Vendor PM north-bound interfaces (Huawei U2020, Nokia NetAct, Ericsson ENM)", status: "available" },
  { name: "Inventory Systems", kind: "telecom", description: "Physical/logical network inventory", status: "available" },
  { name: "Capacity Management Systems", kind: "telecom", description: "Capacity baselines and thresholds", status: "available" },
  { name: "Data Warehouse", kind: "telecom", description: "Curated network data marts", status: "available" },
  { name: "REST APIs", kind: "api", description: "JSON over HTTPS with token auth", status: "available" },
  { name: "SOAP APIs", kind: "api", description: "Legacy OSS web services", status: "available" },
  { name: "Internal OSS APIs", kind: "api", description: "In-house mediation and orchestration endpoints", status: "available" },
];

const KIND_META = {
  file: { icon: FileUp, label: "Files", color: "#10b981" },
  database: { icon: Database, label: "Databases", color: "#3b82f6" },
  telecom: { icon: Network, label: "Telecom Systems", color: "#8b5cf6" },
  api: { icon: Globe, label: "APIs", color: "#06b6d4" },
} as const;

export function SourcesPage() {
  const logAudit = useAppStore((s) => s.logAudit);
  const [modal, setModal] = useState<Connector | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-400">Data Sources</p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-primary">Connector Catalog</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-secondary">
          File upload is fully operational today. Database, telecom-system and API connectors are integration points for
          production deployment — each opens a configuration template showing the parameters the OSS team would supply.
        </p>
      </motion.div>

      {(Object.keys(KIND_META) as (keyof typeof KIND_META)[]).map((kind, gi) => {
        const meta = KIND_META[kind];
        const items = CONNECTORS.filter((c) => c.kind === kind);
        return (
          <motion.section
            key={kind}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + gi * 0.07 }}
            className="mt-8"
          >
            <div className="flex items-center gap-2">
              <meta.icon size={15} style={{ color: meta.color }} />
              <h2 className="text-[14px] font-bold text-primary">{meta.label}</h2>
              <span className="text-[11px] text-muted">({items.length})</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setModal(c);
                    logAudit("CONNECTOR_VIEW", c.name);
                  }}
                  className="panel group flex items-start gap-3 p-4 text-left transition-all hover:border-accent-500/40"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}15`, color: meta.color }}>
                    <Server size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-bold text-primary">{c.name}</span>
                      {c.status === "configured" ? (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-500/12 px-1.5 py-px text-[9px] font-bold uppercase text-success-500">
                          <CheckCircle2 size={9} /> Active
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-inset px-1.5 py-px text-[9px] font-bold uppercase text-muted">
                          Integration point
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">{c.description}</p>
                  </div>
                  <Plug size={14} className="mt-1 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </motion.section>
        );
      })}

      {/* config modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617]/70 p-4 backdrop-blur-sm" onClick={() => setModal(null)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-lg rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/12 text-accent-400">
                  <Cable size={18} />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-primary">{modal.name}</h3>
                  <p className="text-[11px] text-muted">{KIND_META[modal.kind].label} connector</p>
                </div>
              </div>
              <button onClick={() => setModal(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-primary">
                <X size={16} />
              </button>
            </div>

            {modal.status === "configured" ? (
              <p className="mt-4 text-[12.5px] leading-relaxed text-secondary">
                This channel is live. Drag a file onto the Data Hub and the ingestion agent parses it locally — no data
                leaves the workstation.
              </p>
            ) : (
              <>
                <p className="mt-4 text-[12.5px] leading-relaxed text-secondary">
                  Production configuration template — values are supplied by the OSS integration team and stored in the
                  platform vault.
                </p>
                <div className="mt-4 space-y-2.5">
                  {["Host / Endpoint", "Port / Path", "Service account", "Credential reference (vault)", "Sync schedule (cron)"].map((f) => (
                    <div key={f}>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted">{f}</label>
                      <input
                        disabled
                        placeholder="Configured at deployment"
                        className="mt-1 w-full rounded-lg border border-subtle bg-inset px-3 py-2 text-[12px] text-muted placeholder:text-muted/60"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-500/30 bg-warning-500/8 p-3 text-[11.5px] leading-relaxed text-warning-500">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  Connector activation requires OSS admin role and a change-management ticket. The analytics pipeline is
                  source-agnostic: once rows arrive, the same 12 agents run unchanged.
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
