import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { registerChart, unregisterChart } from "@/lib/chartRegistry";

interface EChartProps {
  option: echarts.EChartsOption;
  height?: number | string;
  className?: string;
  /** Register for report exports under this title */
  registerAs?: string;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function EChart({ option, height = 300, className, registerAs, onEvents }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const idRef = useRef<string>(`chart_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    const id = idRef.current;
    return () => {
      ro.disconnect();
      unregisterChart(id);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true });
    if (registerAs) registerChart(idRef.current, registerAs, chart);
  }, [option, registerAs]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [evt, handler] of entries) chart.on(evt, handler as never);
    return () => {
      for (const [evt, handler] of entries) {
        if (!chart.isDisposed()) chart.off(evt, handler as never);
      }
    };
  }, [onEvents]);

  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}
