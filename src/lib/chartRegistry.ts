import type { ECharts } from "echarts";

/* Live ECharts instances register here so the Report Generation agent can
 * embed high-resolution chart images into PDF / PPTX exports. */

const registry = new Map<string, { chart: ECharts; title: string }>();

export function registerChart(id: string, title: string, chart: ECharts) {
  registry.set(id, { chart, title });
}

export function unregisterChart(id: string) {
  registry.delete(id);
}

export function snapshotCharts(limit = 6, isDark = true): { title: string; dataUrl: string; width: number; height: number }[] {
  const out: { title: string; dataUrl: string; width: number; height: number }[] = [];
  for (const { chart, title } of registry.values()) {
    try {
      if (chart.isDisposed()) continue;
      const w = chart.getWidth();
      const h = chart.getHeight();
      if (w < 80 || h < 80) continue;
      const dataUrl = chart.getDataURL({
        pixelRatio: 2,
        backgroundColor: isDark ? "#0f172a" : "#ffffff",
        excludeComponents: ["toolbox"],
      });
      out.push({ title, dataUrl, width: w, height: h });
      if (out.length >= limit) break;
    } catch {
      // skip charts that fail to snapshot
    }
  }
  return out;
}
