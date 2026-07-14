import { useMemo, useState } from "react";
import { ArrowUpDown, Flame } from "lucide-react";
import { healthColor, utilColor } from "@/lib/constants";
import { fmtDate, fmtNum, fmtPct, fmtSigned } from "@/lib/format";
import type { AnalysisResult, EntityStat, RegionStat } from "@/lib/types";

/* --------------------------- shared table chrome -------------------------- */

function Th({ label, onClick, active }: { label: string; onClick?: () => void; active?: boolean }) {
  return (
    <th
      onClick={onClick}
      className={`sticky top-0 z-10 whitespace-nowrap bg-surface-2 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.07em] ${
        onClick ? "cursor-pointer select-none hover:text-primary" : ""
      } ${active ? "text-accent-400" : "text-muted"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {onClick && <ArrowUpDown size={9} className="opacity-60" />}
      </span>
    </th>
  );
}

function UtilBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-inset">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: utilColor(value) }} />
      </div>
      <span className="tabular-nums text-[11.5px] font-semibold" style={{ color: utilColor(value) }}>
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

/** Relative bar for non-percent measures (scaled to the column max). */
function MeasureBar({ value, max, bad }: { value: number; max: number; bad: boolean }) {
  const share = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = bad ? (share >= 80 ? "#ef4444" : share >= 55 ? "#f59e0b" : "#06b6d4") : "#3b82f6";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-inset">
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: color }} />
      </div>
      <span className="tabular-nums text-[11.5px] font-semibold text-secondary">{fmtNum(value)}</span>
    </div>
  );
}

/* ------------------------------ entity table ------------------------------ */

type EntitySortKey = "riskScore" | "p95Util" | "congestedHours" | "growthPctPerWeek" | "alarmCount" | "avgUtil";

export function EntityTable({
  entities,
  mode,
  measureLabel = "Util",
  isPct = true,
  higherIsBad = true,
  maxRows,
}: {
  entities: EntityStat[];
  mode: "risk" | "saturation" | "congestion" | "breakdown";
  measureLabel?: string;
  isPct?: boolean;
  higherIsBad?: boolean;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState<EntitySortKey>(mode === "congestion" ? "congestedHours" : "riskScore");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const base = [...entities];
    if (mode === "saturation") {
      base.sort(
        (a, b) =>
          (a.saturationDate ?? Number.POSITIVE_INFINITY) - (b.saturationDate ?? Number.POSITIVE_INFINITY) ||
          b.riskScore - a.riskScore
      );
    } else {
      base.sort((a, b) => ((b[sortKey] as number) - (a[sortKey] as number)) * (desc ? 1 : -1));
    }
    return base.slice(0, maxRows ?? 12);
  }, [entities, sortKey, desc, mode, maxRows]);

  const maxMeasure = useMemo(() => Math.max(...entities.map((e) => (isPct ? e.p95Util : e.avgUtil)), 1e-9), [entities, isPct]);

  const toggle = (k: EntitySortKey) => {
    if (sortKey === k) setDesc(!desc);
    else {
      setSortKey(k);
      setDesc(true);
    }
  };

  const clean = measureLabel.replace(/^(average|avg)\s+/i, "");
  const shortLabel = clean.length > 14 ? `${clean.slice(0, 13)}…` : clean;

  /* ----------------------- segment breakdown (healthy mix) ----------------- */
  if (mode === "breakdown") {
    const hasSubs = entities.some((e) => (e.subscribers ?? 0) > 0);
    const sorted = [...entities].sort((a, b) =>
      hasSubs ? (b.subscribers ?? 0) - (a.subscribers ?? 0) : b.avgUtil - a.avgUtil
    );
    const subsTotal = sorted.reduce((s, e) => s + (e.subscribers ?? 0), 0) || 1;
    const measTotal = sorted.reduce((s, e) => s + e.avgUtil, 0) || 1;
    const rows2 = sorted.slice(0, maxRows ?? 12);
    return (
      <div className="h-full overflow-auto rounded-lg border border-subtle">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <Th label="Segment" />
              {hasSubs && <Th label="Subscribers" />}
              <Th label={`Avg ${shortLabel}`} />
              <Th label="Share" />
            </tr>
          </thead>
          <tbody>
            {rows2.map((e) => {
              const share = hasSubs ? ((e.subscribers ?? 0) / subsTotal) * 100 : (e.avgUtil / measTotal) * 100;
              return (
                <tr key={e.entity} className="border-t border-subtle transition-colors hover:bg-surface-2">
                  <td className="px-3 py-2 font-semibold text-primary">{e.entity}</td>
                  {hasSubs && <td className="px-3 py-2 tabular-nums text-secondary">{fmtNum(e.subscribers ?? 0, 0)}</td>}
                  <td className="px-3 py-2 tabular-nums text-secondary">{fmtNum(e.avgUtil)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-inset">
                        <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <span className="tabular-nums text-[11.5px] font-semibold text-secondary">{share.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-subtle">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <Th label="Element" />
            <Th label="Region" />
            {isPct ? (
              <Th label="p95 Util" onClick={() => toggle("p95Util")} active={sortKey === "p95Util"} />
            ) : (
              <Th label={`Avg ${shortLabel}`} onClick={() => toggle("avgUtil")} active={sortKey === "avgUtil"} />
            )}
            {mode === "saturation" ? (
              <Th label="Saturation" />
            ) : isPct ? (
              <Th label="Cong. hrs" onClick={() => toggle("congestedHours")} active={sortKey === "congestedHours"} />
            ) : (
              <Th label="Peak" />
            )}
            <Th label="Trend" onClick={() => toggle("growthPctPerWeek")} active={sortKey === "growthPctPerWeek"} />
            <Th label="Risk" onClick={() => toggle("riskScore")} active={sortKey === "riskScore"} />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.entity} className="border-t border-subtle transition-colors hover:bg-surface-2">
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  {e.chronic && <Flame size={11} className="shrink-0 text-critical-500" />}
                  <span className="truncate">{e.entity}</span>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted">{e.region}</td>
              <td className="px-3 py-2">
                {isPct ? <UtilBar value={e.p95Util} /> : <MeasureBar value={e.avgUtil} max={maxMeasure} bad={higherIsBad} />}
              </td>
              {mode === "saturation" ? (
                <td className="whitespace-nowrap px-3 py-2">
                  {e.saturationDate ? (
                    <span className={`font-semibold tabular-nums ${e.saturationDate < Date.now() + 30 * 864e5 ? "text-critical-500" : "text-warning-500"}`}>
                      {fmtDate(e.saturationDate)}
                    </span>
                  ) : (
                    <span className="text-muted">&gt; 180 d</span>
                  )}
                </td>
              ) : isPct ? (
                <td className="px-3 py-2 tabular-nums text-secondary">{e.congestedHours}</td>
              ) : (
                <td className="px-3 py-2 tabular-nums text-secondary">{fmtNum(e.peakUtil)}</td>
              )}
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">{fmtSigned(e.growthPctPerWeek, 1)}/wk</td>
              <td className="px-3 py-2">
                <span
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                  style={{ color: healthColor(100 - e.riskScore), background: `${healthColor(100 - e.riskScore)}1a` }}
                >
                  {e.riskScore.toFixed(0)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ region table ------------------------------ */

export function RegionTable({
  regions,
  measureLabel = "Util",
  isPct = true,
  higherIsBad = true,
}: {
  regions: RegionStat[];
  measureLabel?: string;
  isPct?: boolean;
  higherIsBad?: boolean;
}) {
  const rows = [...regions].sort((a, b) => a.healthScore - b.healthScore);
  const maxMeasure = Math.max(...regions.map((r) => r.avgUtil), 1e-9);
  const hasAlarms = regions.some((r) => r.alarmCount > 0);
  const hasAvail = regions.some((r) => r.availability !== null);
  const hasSubs = regions.some((r) => r.subscribersImpacted > 0);
  const clean = measureLabel.replace(/^(average|avg)\s+/i, "");
  const shortLabel = clean.length > 14 ? `${clean.slice(0, 13)}…` : clean;
  return (
    <div className="h-full overflow-auto rounded-lg border border-subtle">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <Th label="Region" />
            <Th label="Health" />
            <Th label="Elements" />
            <Th label={isPct ? "Avg Util" : `Avg ${shortLabel}`} />
            {isPct && <Th label="Congested" />}
            {hasAlarms && <Th label="Alarms" />}
            {hasAvail && <Th label="Availability" />}
            {hasSubs && <Th label="Subscribers" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.region} className="border-t border-subtle transition-colors hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold text-primary">{r.region}</td>
              <td className="px-3 py-2">
                <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ color: healthColor(r.healthScore), background: `${healthColor(r.healthScore)}1a` }}>
                  {r.healthScore.toFixed(0)}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums text-secondary">{r.entities}</td>
              <td className="px-3 py-2">
                {isPct ? <UtilBar value={r.avgUtil} /> : <MeasureBar value={r.avgUtil} max={maxMeasure} bad={higherIsBad} />}
              </td>
              {isPct && (
                <td className="px-3 py-2 tabular-nums text-secondary">
                  {r.congestedEntities}
                  <span className="text-muted"> ({r.chronicEntities} chronic)</span>
                </td>
              )}
              {hasAlarms && (
                <td className="px-3 py-2 tabular-nums text-secondary">
                  {fmtNum(r.alarmCount, 0)}
                  {r.criticalAlarms > 0 && <span className="ml-1 font-semibold text-critical-500">({fmtNum(r.criticalAlarms, 0)} crit)</span>}
                </td>
              )}
              {hasAvail && <td className="px-3 py-2 tabular-nums text-secondary">{r.availability === null ? "—" : fmtPct(r.availability, 2)}</td>}
              {hasSubs && <td className="px-3 py-2 tabular-nums text-secondary">{r.subscribersImpacted ? fmtNum(r.subscribersImpacted, 0) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------- business delta table -------------------------- */

export function BusinessDeltaTable({ analysis, maxRows }: { analysis: AnalysisResult; maxRows?: number }) {
  const rows = useMemo(() => {
    const stats = new Map(analysis.entityStats.map((e) => [e.entity, e]));
    return analysis.topEntityDaily
      .map((s) => {
        const points = [...s.points].sort((a, b) => a.t - b.t);
        const latestPoint = points.at(-1);
        const previousPoint = points.at(-2);
        const latest = latestPoint?.v ?? 0;
        const previous = previousPoint?.v ?? 0;
        const delta = latest - previous;
        const deltaPct = Math.abs(previous) > 1e-9 ? (delta / Math.abs(previous)) * 100 : null;
        const stat = stats.get(s.name);
        return { entity: s.name, latest, previous, delta, deltaPct, latestT: latestPoint?.t, previousT: previousPoint?.t, stat };
      })
      .sort((a, b) => {
        if (analysis.measureHigherIsBad) return b.delta - a.delta || b.latest - a.latest;
        return b.latest - a.latest;
      })
      .slice(0, maxRows ?? 14);
  }, [analysis, maxRows]);
  const maxLatest = Math.max(...rows.map((r) => r.latest), 1e-9);
  const previousLabel = rows[0]?.previousT ? `Previous (${fmtDate(rows[0].previousT)})` : "Previous";
  const latestLabel = rows[0]?.latestT ? `Latest (${fmtDate(rows[0].latestT)})` : "Latest";
  if (rows.length === 0) return <div className="p-4 text-[12px] text-muted">Needs per-element daily history.</div>;
  return (
    <div className="h-full overflow-auto rounded-lg border border-subtle">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <Th label="Element" />
            <Th label="Region" />
            <Th label={previousLabel} />
            <Th label={latestLabel} />
            <Th label="Delta" />
            <Th label="Delta %" />
            <Th label="Subscribers" />
            <Th label="Rank Reason" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const deltaClass = r.delta > 0 ? (analysis.measureHigherIsBad ? "text-critical-500" : "text-success-500") : r.delta < 0 ? "text-success-500" : "text-muted";
            return (
              <tr key={r.entity} className="border-t border-subtle transition-colors hover:bg-surface-2">
                <td className="px-3 py-2 font-semibold text-primary">{r.entity}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{r.stat?.region ?? "Unknown"}</td>
                <td className="px-3 py-2 tabular-nums text-secondary">{fmtNum(r.previous)}</td>
                <td className="px-3 py-2">
                  {analysis.measureIsPct ? <UtilBar value={r.latest} /> : <MeasureBar value={r.latest} max={maxLatest} bad={analysis.measureHigherIsBad} />}
                </td>
                <td className={`px-3 py-2 tabular-nums font-bold ${deltaClass}`}>{fmtSigned(r.delta, 1, analysis.measureIsPct ? "%" : "")}</td>
                <td className={`px-3 py-2 tabular-nums font-bold ${deltaClass}`}>{r.deltaPct === null ? "—" : fmtSigned(r.deltaPct, 1)}</td>
                <td className="px-3 py-2 tabular-nums text-secondary">{r.stat?.subscribers ? fmtNum(r.stat.subscribers, 0) : "—"}</td>
                <td className="px-3 py-2 text-[11px] leading-relaxed text-muted">
                  {analysis.measureHigherIsBad
                    ? r.delta > 0
                      ? "Worsened vs previous day"
                      : "High latest value"
                    : r.delta < 0
                      ? "Dropped vs previous day"
                      : "Highest latest value"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------- business status table -------------------------- */

export function BusinessStatusBreakdownTable({ analysis }: { analysis: AnalysisResult }) {
  if (analysis.businessStatusBreakdown.length === 0) {
    return <div className="p-4 text-[12px] text-muted">No status column was detected for this report.</div>;
  }
  return (
    <div className="h-full overflow-auto rounded-lg border border-subtle">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <Th label="Status" />
            <Th label="Rows" />
            <Th label="Share" />
            <Th label="Subscribers" />
          </tr>
        </thead>
        <tbody>
          {analysis.businessStatusBreakdown.map((r) => (
            <tr key={r.label} className="border-t border-subtle transition-colors hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold text-primary">{r.label}</td>
              <td className="px-3 py-2 tabular-nums text-secondary">{fmtNum(r.count, 0)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-inset">
                    <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.min(100, r.sharePct)}%` }} />
                  </div>
                  <span className="tabular-nums text-[11.5px] font-semibold text-secondary">{fmtPct(r.sharePct, 1)}</span>
                </div>
              </td>
              <td className="px-3 py-2 tabular-nums text-secondary">{r.subscribersImpacted ? fmtNum(r.subscribersImpacted, 0) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
