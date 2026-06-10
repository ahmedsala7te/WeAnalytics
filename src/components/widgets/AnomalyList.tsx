import { motion } from "framer-motion";
import { Activity, ArrowDownCircle, ArrowUpCircle, Siren } from "lucide-react";
import { fmtDateTime, fmtTimeAgo } from "@/lib/format";
import type { Anomaly } from "@/lib/types";

const KIND_ICON = {
  spike: ArrowUpCircle,
  drop: ArrowDownCircle,
  alarm_storm: Siren,
} as const;

export function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-muted">
        <Activity size={22} className="opacity-50" />
        <p className="text-[12px]">No anomalies detected in this window</p>
      </div>
    );
  }
  return (
    <div className="h-full space-y-2 overflow-y-auto p-1">
      {anomalies.slice(0, 10).map((a, i) => {
        const Icon = KIND_ICON[a.kind];
        const color = a.severity === "critical" ? "#ef4444" : "#f59e0b";
        return (
          <motion.div
            key={`${a.time}-${a.metric}-${i}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-start gap-3 rounded-xl border border-subtle bg-surface-2 p-3"
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1c`, color }}>
              <Icon size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
                  {a.kind === "alarm_storm" ? "Alarm storm" : a.kind === "spike" ? "Spike" : "Sudden drop"}
                  {a.region ? ` · ${a.region}` : ""}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted" title={fmtDateTime(a.time)}>
                  {fmtTimeAgo(a.time)}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-secondary">{a.text}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
