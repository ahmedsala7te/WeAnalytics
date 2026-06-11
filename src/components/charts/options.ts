import type { EChartsOption } from "echarts";
import { SERIES_COLORS, STATUS_COLORS, THRESHOLDS, healthColor, utilColor } from "@/lib/constants";
import { fmtNum } from "@/lib/format";
import type {
  AnalysisResult,
  ChatChart,
  CorrelationPair,
  EntityStat,
  ForecastResult,
  HeatmapData,
  NamedSeries,
  RegionStat,
  SankeyData,
} from "@/lib/types";

/* ------------------------------------------------------------------------
 * Centralized, theme-aware ECharts option builders.
 * ---------------------------------------------------------------------- */

const FONT = "'Inter Variable', 'Inter', 'Segoe UI', sans-serif";

interface Theme {
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  surface: string;
}

export function themeOf(dark: boolean): Theme {
  return dark
    ? {
        text: "#e2e8f0",
        textMuted: "#94a3b8",
        grid: "#1c2740",
        axis: "#334155",
        tooltipBg: "#0f172a",
        tooltipBorder: "#334155",
        surface: "#0f172a",
      }
    : {
        text: "#0f172a",
        textMuted: "#64748b",
        grid: "#e8edf4",
        axis: "#cbd5e1",
        tooltipBg: "#ffffff",
        tooltipBorder: "#e2e8f0",
        surface: "#ffffff",
      };
}

function base(t: Theme): EChartsOption {
  return {
    color: SERIES_COLORS,
    textStyle: { fontFamily: FONT, color: t.textMuted },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.text, fontFamily: FONT, fontSize: 12 },
      padding: [8, 12],
      extraCssText: "box-shadow: 0 8px 24px rgba(2,6,23,.35); border-radius: 10px;",
    },
    animationDuration: 600,
    animationEasing: "cubicOut",
  };
}

function timeAxis(t: Theme) {
  return {
    type: "time" as const,
    axisLine: { lineStyle: { color: t.axis } },
    axisLabel: { color: t.textMuted, fontSize: 11, hideOverlap: true },
    splitLine: { show: false },
    axisTick: { show: false },
  };
}

function valueAxis(t: Theme, opts: { max?: number; name?: string; pct?: boolean } = {}) {
  return {
    type: "value" as const,
    max: opts.max,
    name: opts.name,
    nameTextStyle: { color: t.textMuted, fontSize: 11 },
    axisLabel: {
      color: t.textMuted,
      fontSize: 11,
      formatter: opts.pct ? "{value}%" : (v: number) => fmtNum(v, 0),
    },
    splitLine: { lineStyle: { color: t.grid } },
    axisLine: { show: false },
    axisTick: { show: false },
  };
}

const legend = (t: Theme) => ({
  textStyle: { color: t.textMuted, fontSize: 11, fontFamily: FONT },
  icon: "roundRect" as const,
  itemWidth: 10,
  itemHeight: 4,
  top: 0,
  type: "scroll" as const,
  pageIconColor: t.textMuted,
  pageTextStyle: { color: t.textMuted },
});

const GRID = { left: 42, right: 18, top: 34, bottom: 28, containLabel: false };

/* ----------------------------- Trend (lines) ----------------------------- */

export function trendOption(dark: boolean, series: NamedSeries[], pct: boolean, congestionLine = true): EChartsOption {
  const t = themeOf(dark);
  return {
    ...base(t),
    legend: series.length > 1 ? legend(t) : undefined,
    grid: GRID,
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, { pct, max: pct ? 100 : undefined }),
    series: series.map((s, i) => ({
      name: s.name,
      type: "line" as const,
      smooth: 0.25,
      symbol: "none",
      lineStyle: { width: 2 },
      emphasis: { focus: "series" as const },
      data: s.points.map((p) => [p.t, Math.round(p.v * 10) / 10]),
      ...(i === 0 && series.length === 1
        ? {
            areaStyle: {
              opacity: 0.18,
              color: {
                type: "linear" as const,
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: SERIES_COLORS[0] },
                  { offset: 1, color: "rgba(59,130,246,0)" },
                ],
              },
            },
          }
        : {}),
      markLine:
        pct && congestionLine && i === 0
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: STATUS_COLORS.critical, type: "dashed" as const, opacity: 0.6 },
              label: { color: STATUS_COLORS.critical, fontSize: 10, formatter: "Congestion 90%" },
              data: [{ yAxis: THRESHOLDS.utilizationCongested }],
            }
          : undefined,
    })),
  };
}

/* --------------------------- Area trend (alarms) -------------------------- */

export function areaTrendOption(dark: boolean, s: NamedSeries, color = "#f59e0b"): EChartsOption {
  const t = themeOf(dark);
  return {
    ...base(t),
    grid: GRID,
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, {}),
    series: [
      {
        name: s.name,
        type: "line",
        smooth: 0.3,
        symbol: "none",
        lineStyle: { width: 2, color },
        areaStyle: {
          opacity: 0.25,
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ],
          },
        },
        data: s.points.map((p) => [p.t, Math.round(p.v)]),
      },
    ],
  };
}

/* -------------------------------- Heatmap -------------------------------- */

export function heatmapOption(dark: boolean, hm: HeatmapData): EChartsOption {
  const t = themeOf(dark);
  const data: [number, number, number | null][] = [];
  hm.regions.forEach((_, ri) => {
    for (let h = 0; h < 24; h++) {
      const v = hm.matrix[ri][h];
      data.push([h, ri, v === null ? null : Math.round(v * 10) / 10]);
    }
  });
  return {
    ...base(t),
    tooltip: {
      ...((base(t).tooltip as object) ?? {}),
      trigger: "item",
      formatter: (p: unknown) => {
        const [h, ri, v] = (p as { value: [number, number, number | null] }).value;
        return `<b>${hm.regions[ri]}</b><br/>${String(h).padStart(2, "0")}:00 — ${v === null ? "no data" : v + "% avg utilization"}`;
      },
    },
    grid: { left: 110, right: 60, top: 8, bottom: 30 },
    xAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}`),
      axisLabel: { color: t.textMuted, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
    },
    yAxis: {
      type: "category",
      data: hm.regions,
      axisLabel: { color: t.text, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      min: 30,
      max: 100,
      calculable: false,
      orient: "vertical",
      right: 4,
      top: "center",
      itemHeight: 110,
      textStyle: { color: t.textMuted, fontSize: 10 },
      inRange: { color: ["#10b981", "#84cc16", "#f59e0b", "#f97316", "#ef4444"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 1.5, borderRadius: 3 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.4)" } },
      },
    ],
  };
}

/* ------------------------------- Busy hour -------------------------------- */

export function busyHourOption(dark: boolean, profile: (number | null)[]): EChartsOption {
  const t = themeOf(dark);
  const vals = profile.map((v) => (v === null ? 0 : Math.round(v * 10) / 10));
  const maxIdx = vals.indexOf(Math.max(...vals));
  return {
    ...base(t),
    grid: GRID,
    xAxis: {
      type: "category",
      data: profile.map((_, h) => `${String(h).padStart(2, "0")}:00`),
      axisLabel: { color: t.textMuted, fontSize: 10, interval: 2 },
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
    },
    yAxis: valueAxis(t, { pct: true }),
    series: [
      {
        name: "Avg utilization",
        type: "bar",
        barWidth: "62%",
        data: vals.map((v, h) => ({
          value: v,
          itemStyle: {
            color: h === maxIdx ? "#ef4444" : utilColor(v),
            opacity: h === maxIdx ? 1 : 0.78,
            borderRadius: [4, 4, 0, 0],
          },
        })),
        markPoint: {
          symbol: "pin",
          symbolSize: 38,
          itemStyle: { color: "#ef4444" },
          label: { fontSize: 9, color: "#fff", formatter: "BH" },
          data: [{ type: "max", name: "Busy hour" }],
        },
      },
    ],
  };
}

/* -------------------------------- Pareto ---------------------------------- */

export function paretoOption(dark: boolean, labels: string[], values: number[], unit: string): EChartsOption {
  const t = themeOf(dark);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const cum = values.map((v) => {
    acc += v;
    return Math.round((acc / total) * 1000) / 10;
  });
  return {
    ...base(t),
    grid: { ...GRID, right: 46, bottom: 64 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: t.textMuted, fontSize: 9, rotate: 38, width: 90, overflow: "truncate" as const },
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
    },
    yAxis: [
      valueAxis(t, { name: unit }),
      { ...valueAxis(t, { pct: true, max: 100 }), splitLine: { show: false } },
    ],
    series: [
      {
        name: unit,
        type: "bar",
        barWidth: "55%",
        data: values.map((v) => ({ value: v, itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] } })),
      },
      {
        name: "Cumulative %",
        type: "line",
        yAxisIndex: 1,
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
        lineStyle: { color: "#f59e0b", width: 2 },
        itemStyle: { color: "#f59e0b" },
        data: cum,
      },
    ],
  };
}

/* -------------------------------- Treemap --------------------------------- */

export function treemapOption(dark: boolean, regions: RegionStat[]): EChartsOption {
  const t = themeOf(dark);
  return {
    ...base(t),
    tooltip: {
      ...((base(t).tooltip as object) ?? {}),
      trigger: "item",
      formatter: (raw: unknown) => {
        const p = raw as { name: string; value: number; data: { health?: number } };
        return `<b>${p.name}</b><br/>Risk-weighted traffic: ${fmtNum(p.value)}<br/>Health: ${p.data.health?.toFixed(0) ?? "—"}/100`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { show: true, formatter: "{b}", fontSize: 12, fontFamily: FONT },
        upperLabel: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2 },
        data: regions.map((r) => ({
          name: r.region,
          value: Math.max(1, Math.round(r.trafficMbps || r.entities * 10)),
          health: r.healthScore,
          itemStyle: { color: healthColor(r.healthScore) },
        })),
      },
    ],
  };
}

/* --------------------------------- Sankey --------------------------------- */

export function sankeyOption(dark: boolean, data: SankeyData): EChartsOption {
  const t = themeOf(dark);
  const stateColors: Record<string, string> = {
    Healthy: "#10b981",
    Elevated: "#06b6d4",
    Congested: "#f59e0b",
    Critical: "#ef4444",
  };
  return {
    ...base(t),
    tooltip: { ...((base(t).tooltip as object) ?? {}), trigger: "item" },
    series: [
      {
        type: "sankey",
        layoutIterations: 40,
        nodeWidth: 14,
        nodeGap: 10,
        left: 4,
        right: 80,
        top: 10,
        bottom: 10,
        emphasis: { focus: "adjacency" as const },
        label: { color: t.text, fontSize: 11, fontFamily: FONT },
        lineStyle: { color: "gradient" as const, opacity: 0.35, curveness: 0.5 },
        itemStyle: { borderWidth: 0 },
        data: data.nodes.map((n) => ({
          name: n.name,
          itemStyle: { color: stateColors[n.name] ?? "#3b82f6" },
        })),
        links: data.links,
      },
    ],
  };
}

/* --------------------------------- Scatter -------------------------------- */

export function scatterOption(dark: boolean, entities: EntityStat[]): EChartsOption {
  const t = themeOf(dark);
  const data = entities.slice(0, 160).map((e) => ({
    name: e.entity,
    value: [
      Math.round(e.p95Util * 10) / 10,
      Math.round(e.growthPctPerWeek * 100) / 100,
      e.subscribers ?? 800,
      e.region,
    ],
    itemStyle: { color: e.chronic ? "#ef4444" : utilColor(e.p95Util), opacity: 0.8 },
  }));
  return {
    ...base(t),
    tooltip: {
      ...((base(t).tooltip as object) ?? {}),
      trigger: "item",
      formatter: (raw: unknown) => {
        const p = raw as { name: string; value: [number, number, number, string] };
        return `<b>${p.name}</b> · ${p.value[3]}<br/>p95 utilization: ${p.value[0]}%<br/>Growth: ${p.value[1]}%/wk<br/>Subscribers: ${fmtNum(p.value[2], 0)}`;
      },
    },
    grid: { ...GRID, left: 48 },
    xAxis: { ...valueAxis(t, { pct: true, name: "p95 utilization" }), type: "value", min: 0, max: 100 },
    yAxis: valueAxis(t, { name: "growth %/wk" }),
    series: [
      {
        type: "scatter",
        symbolSize: (v: number[]) => Math.max(7, Math.min(30, Math.sqrt(v[2]) / 2.4)),
        data,
        markArea: {
          silent: true,
          itemStyle: { color: "rgba(239,68,68,0.07)" },
          data: [[{ xAxis: 90, yAxis: 0 }, { xAxis: 100, yAxis: 999 }]] as never,
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: t.axis, type: "dashed" as const },
          label: { color: t.textMuted, fontSize: 9 },
          data: [{ xAxis: THRESHOLDS.utilizationCongested }],
        },
      },
    ],
  };
}

/* -------------------------------- Forecast -------------------------------- */

export function forecastOption(dark: boolean, fc: ForecastResult): EChartsOption {
  const t = themeOf(dark);
  const pct = fc.unit === "%";
  const hist = fc.history.map((p) => [p.t, Math.round(p.v * 10) / 10]);
  const fcast = [
    hist[hist.length - 1],
    ...fc.forecast.map((p) => [p.t, Math.round(p.v * 10) / 10]),
  ];
  const lower = fc.lower.map((p) => [p.t, Math.round(p.v * 10) / 10]);
  const band = fc.upper.map((p, i) => [p.t, Math.round((p.v - fc.lower[i].v) * 10) / 10]);
  return {
    ...base(t),
    legend: legend(t),
    grid: GRID,
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, { pct, max: pct ? 100 : undefined }),
    series: [
      {
        name: "History",
        type: "line",
        symbol: "none",
        smooth: 0.2,
        lineStyle: { width: 2, color: "#3b82f6" },
        areaStyle: { opacity: 0.1, color: "#3b82f6" },
        data: hist,
      },
      {
        name: "Forecast",
        type: "line",
        symbol: "none",
        smooth: 0.2,
        lineStyle: { width: 2, color: "#8b5cf6", type: "dashed" },
        data: fcast,
        markLine: fc.saturationDate
          ? {
              symbol: "none",
              lineStyle: { color: "#ef4444", type: "solid", width: 1.5 },
              label: {
                color: "#ef4444",
                fontSize: 10,
                formatter: `Saturation ≥${fc.saturationThreshold}%`,
                position: "insideEndTop" as const,
              },
              data: [{ xAxis: fc.saturationDate }],
            }
          : undefined,
      },
      // confidence band (stacked transparent + band fill)
      {
        name: "80% band",
        type: "line",
        stack: "band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        data: lower,
        tooltip: { show: false },
      },
      {
        name: "80% band",
        type: "line",
        stack: "band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "#8b5cf6", opacity: 0.14 },
        data: band,
        tooltip: { show: false },
      },
    ],
  };
}

/* -------------------------------- Histogram -------------------------------- */

export function histogramOption(dark: boolean, dist: NonNullable<AnalysisResult["distribution"]>): EChartsOption {
  const t = themeOf(dark);
  return {
    ...base(t),
    grid: { ...GRID, bottom: 48 },
    xAxis: {
      type: "category",
      data: dist.bins,
      name: dist.metric,
      nameLocation: "middle" as const,
      nameGap: 34,
      nameTextStyle: { color: t.textMuted, fontSize: 11 },
      axisLabel: { color: t.textMuted, fontSize: 9, rotate: 30 },
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
    },
    yAxis: valueAxis(t, { name: "samples" }),
    series: [
      {
        name: "Samples",
        type: "bar",
        barWidth: "78%",
        data: dist.counts.map((c, i) => ({
          value: c,
          itemStyle: {
            color: dist.metric.includes("%") || dist.metric.toLowerCase().includes("util")
              ? utilColor(((i + 0.5) / dist.bins.length) * 100)
              : "#3b82f6",
            opacity: 0.85,
            borderRadius: [3, 3, 0, 0],
          },
        })),
      },
    ],
  };
}

/* ---------------------------------- Gauge ---------------------------------- */

export function gaugeOption(dark: boolean, score: number): EChartsOption {
  const t = themeOf(dark);
  return {
    textStyle: { fontFamily: FONT },
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: "100%",
        center: ["50%", "60%"],
        pointer: { show: false },
        progress: {
          show: true,
          width: 14,
          roundCap: true,
          itemStyle: { color: healthColor(score) },
        },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, dark ? "#1e293b" : "#e2e8f0"]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 34,
          fontWeight: 700,
          fontFamily: FONT,
          color: t.text,
          offsetCenter: [0, "-12%"],
          formatter: (v: number) => v.toFixed(1),
        },
        data: [{ value: Math.round(score * 10) / 10 }],
      },
    ],
  };
}

/* ------------------------------ Correlation bars --------------------------- */

export function correlationOption(dark: boolean, pairs: CorrelationPair[]): EChartsOption {
  const t = themeOf(dark);
  const top = pairs.slice(0, 7).reverse();
  return {
    ...base(t),
    tooltip: {
      ...((base(t).tooltip as object) ?? {}),
      trigger: "item",
      formatter: (raw: unknown) => {
        const p = raw as { name: string; value: number };
        return `<b>${p.name}</b><br/>Pearson r = ${p.value}`;
      },
    },
    grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
    xAxis: { ...valueAxis(t, {}), min: -1, max: 1 },
    yAxis: {
      type: "category",
      data: top.map((p) => `${p.a} ↔ ${p.b}`),
      axisLabel: { color: t.text, fontSize: 10.5 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "55%",
        label: {
          show: true,
          position: "right" as const,
          color: t.textMuted,
          fontSize: 10,
          formatter: (raw: unknown) => String((raw as { value: number }).value),
        },
        data: top.map((p) => ({
          value: Math.round(p.r * 100) / 100,
          itemStyle: { color: p.r > 0 ? "#3b82f6" : "#ec4899", borderRadius: 3 },
        })),
      },
    ],
  };
}

/* ------------------- Per-element comparison (grouped bars) ----------------- */

/**
 * X = elements, one bar series per day (≤7 days) — "3 bars for every MSAN".
 * Falls back to one line per element for longer histories.
 */
export function entityBarsOption(dark: boolean, series: NamedSeries[], measureLabel: string, isPct: boolean): EChartsOption {
  const t = themeOf(dark);
  const dayKeys = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);

  if (dayKeys.length <= 7) {
    const fmtDay = (ms: number) =>
      new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return {
      ...base(t),
      legend: legend(t),
      grid: { ...GRID, bottom: 64 },
      xAxis: {
        type: "category",
        data: series.map((s) => s.name),
        axisLabel: { color: t.textMuted, fontSize: 9, rotate: 38, width: 90, overflow: "truncate" as const },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: valueAxis(t, { pct: isPct, max: isPct ? 100 : undefined, name: measureLabel.toLowerCase() }),
      series: dayKeys.map((day, di) => ({
        name: fmtDay(day),
        type: "bar" as const,
        barGap: "10%",
        emphasis: { focus: "series" as const },
        itemStyle: { color: SERIES_COLORS[di % SERIES_COLORS.length], borderRadius: [3, 3, 0, 0] },
        data: series.map((s) => {
          const p = s.points.find((x) => x.t === day);
          return p ? Math.round(p.v * 10) / 10 : null;
        }),
      })),
    };
  }

  // long histories: one line per element (capped upstream)
  return {
    ...base(t),
    legend: legend(t),
    grid: GRID,
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, { pct: isPct, max: isPct ? 100 : undefined }),
    series: series.slice(0, 8).map((s) => ({
      name: s.name,
      type: "line" as const,
      smooth: 0.25,
      symbol: "none",
      lineStyle: { width: 2 },
      emphasis: { focus: "series" as const },
      data: s.points.map((p) => [p.t, Math.round(p.v * 10) / 10]),
    })),
  };
}

/* ------------------------------- Chat charts ------------------------------- */

export function chatChartOption(dark: boolean, c: ChatChart): EChartsOption {
  const t = themeOf(dark);
  if (c.kind === "line") {
    return {
      ...base(t),
      grid: { left: 40, right: 12, top: 14, bottom: 24 },
      xAxis: {
        type: "category",
        data: c.labels,
        axisLabel: { color: t.textMuted, fontSize: 9, interval: Math.ceil(c.labels.length / 7) },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: valueAxis(t, {}),
      series: [
        {
          name: c.name,
          type: "line",
          symbol: "none",
          smooth: 0.25,
          lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: { opacity: 0.15, color: "#3b82f6" },
          data: c.values,
        },
      ],
    };
  }
  return {
    ...base(t),
    tooltip: { ...((base(t).tooltip as object) ?? {}), trigger: "item" },
    grid: { left: 8, right: 30, top: 6, bottom: 6, containLabel: true },
    xAxis: valueAxis(t, {}),
    yAxis: {
      type: "category",
      data: [...c.labels].reverse(),
      axisLabel: { color: t.text, fontSize: 10, width: 110, overflow: "truncate" as const },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: c.name,
        type: "bar",
        barWidth: "58%",
        label: {
          show: true,
          position: "right" as const,
          color: t.textMuted,
          fontSize: 9.5,
          formatter: (raw: unknown) => fmtNum((raw as { value: number }).value),
        },
        data: [...c.values].reverse().map((v) => ({ value: v, itemStyle: { color: "#3b82f6", borderRadius: 3 } })),
      },
    ],
  };
}

/* ------------------------------- Sparklines -------------------------------- */

export function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * (h - 3) - 1.5).toFixed(1)}`)
    .join(" ");
}
