import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Check, ChevronDown, Cpu, Loader2, MapPin, RotateCcw, Search } from "lucide-react";
import dayjs from "dayjs";
import { useAppStore } from "@/store/useAppStore";

function useOutsideClose(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onBlur = (e: React.FocusEvent) => {
    if (ref.current && !ref.current.contains(e.relatedTarget as Node)) close();
  };
  return { ref, onBlur };
}

function Dropdown({
  icon: Icon,
  label,
  active,
  children,
}: {
  icon: typeof Calendar;
  label: string;
  active: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { ref, onBlur } = useOutsideClose(() => setOpen(false));
  return (
    <div className="relative" ref={ref} onBlur={onBlur}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
          active ? "border-accent-500/60 bg-accent-500/10 text-accent-400" : "border-subtle bg-surface text-secondary hover:border-strong"
        }`}
      >
        <Icon size={13} />
        {label}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="glass absolute left-0 top-full z-30 mt-1.5 min-w-52 rounded-xl p-2 shadow-2xl"
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FilterBar() {
  const analysis = useAppStore((s) => s.viewAnalysis);
  const datasets = useAppStore((s) => s.datasets);
  const activeId = useAppStore((s) => s.activeDatasetId);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const viewLoading = useAppStore((s) => s.viewLoading);
  const fullAnalysis = useAppStore((s) => (s.activeDatasetId ? s.analyses[s.activeDatasetId] : null));

  const dataset = datasets.find((d) => d.id === activeId);
  const [searchDraft, setSearchDraft] = useState("");

  const regionOptions = useMemo(() => fullAnalysis?.regionStats.map((r) => r.region) ?? [], [fullAnalysis]);
  const techOptions = useMemo(() => {
    if (!dataset || !fullAnalysis?.mapping.technology) return [];
    const col = fullAnalysis.mapping.technology;
    const set = new Set<string>();
    for (const r of dataset.rows) {
      if (r[col] !== null && r[col] !== undefined) set.add(String(r[col]));
      if (set.size > 12) break;
    }
    return [...set].sort();
  }, [dataset, fullAnalysis]);

  if (!analysis) return null;
  const tr = fullAnalysis?.timeRange ?? null;

  const datePresets: { label: string; days: number | null }[] = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 14 days", days: 14 },
    { label: "Last 30 days", days: 30 },
    { label: "Full window", days: null },
  ];

  const dateActive = filters.dateStart !== null || filters.dateEnd !== null;
  const dateLabel = dateActive
    ? `${dayjs(filters.dateStart ?? tr?.start).format("DD MMM")} – ${dayjs(filters.dateEnd ?? tr?.end).format("DD MMM")}`
    : "Full window";

  const hasFilters = dateActive || filters.regions.length > 0 || !!filters.technology || !!filters.search.trim();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tr && (
        <Dropdown icon={Calendar} label={dateLabel} active={dateActive}>
          {(close) => (
            <div className="space-y-0.5">
              {datePresets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    if (p.days === null) setFilters({ dateStart: null, dateEnd: null });
                    else setFilters({ dateStart: tr.end - p.days * 864e5, dateEnd: tr.end });
                    close();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-surface-2"
                >
                  {p.label}
                  {((p.days === null && !dateActive) ||
                    (p.days !== null && filters.dateStart === tr.end - p.days * 864e5)) && <Check size={13} className="text-accent-400" />}
                </button>
              ))}
              <div className="border-t border-subtle pt-1.5 text-[10px] text-muted px-2.5 pb-1">
                Data window: {dayjs(tr.start).format("DD MMM")} → {dayjs(tr.end).format("DD MMM YYYY")}
              </div>
            </div>
          )}
        </Dropdown>
      )}

      {regionOptions.length > 1 && (
        <Dropdown
          icon={MapPin}
          label={filters.regions.length === 0 ? "All regions" : filters.regions.length === 1 ? filters.regions[0] : `${filters.regions.length} regions`}
          active={filters.regions.length > 0}
        >
          {() => (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              <button
                onClick={() => setFilters({ regions: [] })}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-secondary hover:bg-surface-2"
              >
                All regions
                {filters.regions.length === 0 && <Check size={13} className="text-accent-400" />}
              </button>
              {regionOptions.map((r) => {
                const checked = filters.regions.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => setFilters({ regions: checked ? filters.regions.filter((x) => x !== r) : [...filters.regions, r] })}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-surface-2"
                  >
                    {r}
                    {checked && <Check size={13} className="text-accent-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </Dropdown>
      )}

      {techOptions.length > 1 && (
        <Dropdown icon={Cpu} label={filters.technology ?? "All technologies"} active={!!filters.technology}>
          {(close) => (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setFilters({ technology: null });
                  close();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-secondary hover:bg-surface-2"
              >
                All technologies
                {!filters.technology && <Check size={13} className="text-accent-400" />}
              </button>
              {techOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setFilters({ technology: t });
                    close();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-surface-2"
                >
                  {t}
                  {filters.technology === t && <Check size={13} className="text-accent-400" />}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ search: searchDraft });
        }}
        className="relative"
      >
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Filter elements…"
          className="w-44 rounded-lg border border-subtle bg-surface py-1.5 pl-8 pr-2 text-[12px] text-primary placeholder:text-muted focus:border-accent-500 focus:outline-none"
        />
      </form>

      {hasFilters && (
        <button
          onClick={() => {
            setSearchDraft("");
            resetFilters();
          }}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-muted transition-colors hover:text-critical-500"
        >
          <RotateCcw size={12} /> Reset
        </button>
      )}

      {viewLoading && (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-accent-400">
          <Loader2 size={12} className="animate-spin" /> Re-analyzing…
        </span>
      )}
    </div>
  );
}
