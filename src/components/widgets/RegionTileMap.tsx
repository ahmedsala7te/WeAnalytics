import { motion } from "framer-motion";
import { AlertTriangle, TrendingUp, Users } from "lucide-react";
import { healthColor, healthLabel } from "@/lib/constants";
import { fmtNum, fmtPct, fmtSigned } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import type { RegionStat } from "@/lib/types";

/** Wallboard-style regional health map (geo-free, NOC friendly). */
export function RegionTileMap({
  regions,
  measureLabel = "util",
  isPct = true,
}: {
  regions: RegionStat[];
  measureLabel?: string;
  isPct?: boolean;
}) {
  const setFilters = useAppStore((s) => s.setFilters);
  const filters = useAppStore((s) => s.filters);
  const sorted = [...regions].sort((a, b) => a.healthScore - b.healthScore);

  return (
    <div className="grid grid-cols-2 gap-2.5 p-1 sm:grid-cols-3 lg:grid-cols-5">
      {sorted.map((r, i) => {
        const color = healthColor(r.healthScore);
        const active = filters.regions.includes(r.region);
        return (
          <motion.button
            key={r.region}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04, duration: 0.35 }}
            whileHover={{ y: -3, scale: 1.015 }}
            onClick={() => setFilters({ regions: active ? [] : [r.region] })}
            className={`relative overflow-hidden rounded-xl border p-3 text-left transition-shadow ${
              active ? "border-accent-500 shadow-glow" : "border-subtle hover:border-strong"
            }`}
            style={{ background: `linear-gradient(145deg, ${color}14, transparent 65%)` }}
            title={`${r.region} — click to ${active ? "clear filter" : "filter workspace"}`}
          >
            <div className="flex items-start justify-between gap-1">
              <span className="truncate text-[12px] font-semibold text-primary">{r.region}</span>
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full animate-pulse-dot" style={{ background: color }} />
            </div>
            <div className="mt-1.5 text-[20px] font-bold tabular-nums leading-6" style={{ color }}>
              {r.healthScore.toFixed(0)}
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide opacity-90">{healthLabel(r.healthScore)}</span>
            </div>
            <div className="mt-2 space-y-1 text-[10.5px] text-muted">
              <div className="flex items-center justify-between">
                <span className="truncate pr-1">
                  {isPct ? "Avg util" : `Avg ${measureLabel.replace(/^(average|avg)\s+/i, "").toLowerCase()}`}
                </span>
                <span className="font-semibold tabular-nums text-secondary">{isPct ? fmtPct(r.avgUtil, 0) : fmtNum(r.avgUtil)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1"><AlertTriangle size={10} /> {isPct ? "Congested" : "Elements"}</span>
                <span className="font-semibold tabular-nums text-secondary">{isPct ? `${r.congestedEntities}/${r.entities}` : r.entities}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1"><TrendingUp size={10} /> Growth</span>
                <span className="font-semibold tabular-nums text-secondary">{fmtSigned(r.growthPctPerWeek, 1)}/wk</span>
              </div>
              {r.subscribersImpacted > 0 && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1"><Users size={10} /> Impacted</span>
                  <span className="font-semibold tabular-nums" style={{ color }}>{fmtNum(r.subscribersImpacted, 0)}</span>
                </div>
              )}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
