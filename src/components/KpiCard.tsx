import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { STATUS_COLORS } from "@/lib/constants";
import { fmtKpiValue, fmtSigned } from "@/lib/format";
import { sparkPath } from "@/components/charts/options";
import type { Kpi } from "@/lib/types";

const STATUS_LABEL: Record<Kpi["status"], string> = {
  healthy: "Healthy",
  watch: "Stable",
  warning: "Warning",
  critical: "Critical",
};

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      setVal(target);
      return;
    }
    started.current = true;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

export function KpiCard({ kpi, delay = 0 }: { kpi: Kpi; delay?: number }) {
  const animated = useCountUp(kpi.value);
  const color = STATUS_COLORS[kpi.status];
  const changeIsGood =
    kpi.changePct === null || kpi.goodWhen === "neutral"
      ? null
      : (kpi.changePct >= 0 && kpi.goodWhen === "high") || (kpi.changePct <= 0 && kpi.goodWhen === "low");

  const spark = kpi.spark.length >= 3 ? kpi.spark : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="panel group relative overflow-hidden px-4 py-3.5"
      title={`${kpi.description}\nFormula: ${kpi.formula}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted leading-tight">{kpi.name}</span>
        <span
          className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide"
          style={{ color, background: `${color}1a` }}
        >
          {STATUS_LABEL[kpi.status]}
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[22px] font-bold leading-7 text-primary tabular-nums tracking-tight">
            {fmtKpiValue(animated, kpi.unit)}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px]">
            {kpi.changePct !== null ? (
              <>
                {kpi.changePct > 0.05 ? (
                  <ArrowUpRight size={12} style={{ color: changeIsGood === null ? "var(--text-muted)" : changeIsGood ? STATUS_COLORS.healthy : STATUS_COLORS.critical }} />
                ) : kpi.changePct < -0.05 ? (
                  <ArrowDownRight size={12} style={{ color: changeIsGood === null ? "var(--text-muted)" : changeIsGood ? STATUS_COLORS.healthy : STATUS_COLORS.critical }} />
                ) : (
                  <Minus size={12} className="text-muted" />
                )}
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: changeIsGood === null ? "var(--text-muted)" : changeIsGood ? STATUS_COLORS.healthy : STATUS_COLORS.critical }}
                >
                  {fmtSigned(kpi.changePct, 1)}
                </span>
                <span className="text-muted">vs prior</span>
              </>
            ) : (
              <span className="text-muted">current window</span>
            )}
          </div>
        </div>
        {spark.length > 0 && (
          <svg width="72" height="30" viewBox="0 0 72 30" className="shrink-0 opacity-90">
            <path d={sparkPath(spark, 72, 30)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </motion.div>
  );
}
