import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer, HexagonLayer } from "@deck.gl/aggregation-layers";
import type { Layer } from "@deck.gl/core";
import { Box, Flame, Layers3, MapPin, RotateCcw, Search, X } from "lucide-react";
import { EGYPT_VIEW } from "@/data/egyptGeography";
import { fmtNum, fmtPct } from "@/lib/format";
import type { AnalysisResult, GeoSiteStat } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

type LayerMode = "sites" | "columns" | "heat";
type MetricKey = "riskScore" | "avgUtil" | "alarmCount" | "subscribers";
type BasemapStatus = "loading" | "stadia" | "openfree" | "offline";

const STADIA_STYLE_BASE = "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json";
const STADIA_API_KEY = import.meta.env.VITE_STADIA_MAPS_API_KEY?.trim();
const STADIA_DARK_BASEMAP = STADIA_API_KEY
  ? `${STADIA_STYLE_BASE}?api_key=${encodeURIComponent(STADIA_API_KEY)}`
  : STADIA_STYLE_BASE;
const OPENFREE_DARK_FALLBACK = "https://tiles.openfreemap.org/styles/dark";
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "offline-background",
      type: "background",
      paint: { "background-color": "#070b12" },
    },
  ],
};

const HEAT_COLORS: [number, number, number, number][] = [
  [27, 9, 58, 0],
  [126, 24, 126, 150],
  [224, 45, 154, 205],
  [249, 102, 114, 225],
  [255, 176, 79, 240],
  [255, 244, 184, 255],
];

const COLUMN_COLORS: [number, number, number][] = [
  [27, 9, 58],
  [126, 24, 126],
  [224, 45, 154],
  [249, 102, 114],
  [255, 176, 79],
  [255, 244, 184],
];

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "riskScore", label: "Risk" },
  { key: "avgUtil", label: "Utilization" },
  { key: "alarmCount", label: "Alarms" },
  { key: "subscribers", label: "Subscribers" },
];

export function EgyptNetworkMap({ analysis }: { analysis: AnalysisResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const setFilters = useAppStore((s) => s.setFilters);
  const filters = useAppStore((s) => s.filters);
  const [mode, setMode] = useState<LayerMode>("heat");
  const [metric, setMetric] = useState<MetricKey>("riskScore");
  const [selected, setSelected] = useState<GeoSiteStat | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [basemapStatus, setBasemapStatus] = useState<BasemapStatus>("loading");
  const [overlayReady, setOverlayReady] = useState(false);
  const sites = analysis.geoSites;

  useEffect(() => {
    if (!containerRef.current || sites.length === 0) return;

    let map: MapLibreMap;
    let disposed = false;
    let provider: Exclude<BasemapStatus, "loading"> = "stadia";
    let providerLoaded = false;
    let fallbackTimer = 0;

    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STADIA_DARK_BASEMAP,
        center: [EGYPT_VIEW.longitude, EGYPT_VIEW.latitude],
        zoom: EGYPT_VIEW.zoom,
        pitch: EGYPT_VIEW.pitch,
        bearing: EGYPT_VIEW.bearing,
        attributionControl: false,
        cooperativeGestures: true,
        maxPitch: 72,
      });
    } catch {
      setRendererError("The interactive map could not initialize. The tabular analytics remain available.");
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const scheduleFallback = () => {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(activateFallback, 6000);
    };

    const activateFallback = () => {
      if (disposed || providerLoaded) return;
      if (provider === "stadia") {
        provider = "openfree";
        setBasemapStatus("openfree");
        map.setStyle(OPENFREE_DARK_FALLBACK);
        scheduleFallback();
        return;
      }
      provider = "offline";
      setBasemapStatus("offline");
      map.setStyle(OFFLINE_STYLE);
      scheduleFallback();
    };

    scheduleFallback();

    map.on("style.load", () => {
      if (disposed) return;
      providerLoaded = true;
      window.clearTimeout(fallbackTimer);
      setBasemapStatus(provider);
      setRendererError(null);

      if (provider !== "offline") {
        highlightBoundaries(map);
        addThreeDimensionalBuildings(map);
      }

      if (!overlayRef.current) {
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        overlayRef.current = overlay;
        map.addControl(overlay as unknown as maplibregl.IControl);
        setOverlayReady(true);
      }
    });

    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimer);
      setOverlayReady(false);
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [sites.length]);

  const valueOf = (site: GeoSiteStat) => Number(site[metric] ?? 0);
  const maxValue = useMemo(() => Math.max(1, ...sites.map(valueOf)), [sites, metric]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const layers: Layer[] = [];
    if (mode === "columns") {
      layers.push(
        new HexagonLayer<GeoSiteStat>({
          id: `egypt-columns-${metric}`,
          data: sites,
          getPosition: (d) => [d.longitude, d.latitude],
          getColorWeight: valueOf,
          getElevationWeight: valueOf,
          colorRange: COLUMN_COLORS,
          elevationScale: metric === "subscribers" ? 0.55 : metric === "alarmCount" ? 11 : 155,
          radius: 14500,
          extruded: true,
          coverage: 0.82,
          pickable: false,
          opacity: 0.88,
        })
      );
    }

    if (mode === "heat") {
      layers.push(
        new HeatmapLayer<GeoSiteStat>({
          id: `egypt-heat-${metric}`,
          data: sites,
          getPosition: (d) => [d.longitude, d.latitude],
          getWeight: valueOf,
          colorRange: HEAT_COLORS,
          radiusPixels: 72,
          intensity: 1.45,
          threshold: 0.025,
          opacity: 0.88,
        })
      );
    }

    layers.push(
      new ScatterplotLayer<GeoSiteStat>({
        id: `egypt-sites-${metric}-${mode}`,
        data: sites,
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: (d) => (selected?.entity === d.entity ? 7200 : mode === "sites" ? 4700 : 2500),
        getFillColor: (d) => neonMetricColor(valueOf(d), maxValue, mode === "heat" ? 185 : 230),
        getLineColor: (d) => (selected?.entity === d.entity ? [255, 255, 255, 255] : [255, 220, 244, 190]),
        getLineWidth: (d) => (selected?.entity === d.entity ? 4 : 1.2),
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        radiusMinPixels: mode === "sites" ? 5 : 3,
        radiusMaxPixels: 18,
        onClick: ({ object }) => object && setSelected(object),
      })
    );

    overlay.setProps({
      layers,
      getTooltip: ({ object }) => {
        const site = object as GeoSiteStat | undefined;
        return site?.entity
          ? { text: `${site.entity}\n${site.region}\n${metricLabel(metric)}: ${formatMetric(metric, valueOf(site))}` }
          : null;
      },
    });
  }, [sites, mode, metric, maxValue, selected, overlayReady]);

  if (sites.length === 0) {
    return <div className="flex min-h-96 items-center justify-center text-sm text-muted">No valid Egypt coordinates were found.</div>;
  }

  const quality = analysis.geoQuality;
  const setMapMode = (nextMode: LayerMode) => {
    setMode(nextMode);
    mapRef.current?.easeTo({
      center: nextMode === "columns" ? [31, 27.4] : [EGYPT_VIEW.longitude, EGYPT_VIEW.latitude],
      zoom: nextMode === "columns" ? 5.1 : EGYPT_VIEW.zoom,
      pitch: nextMode === "columns" ? 44 : nextMode === "heat" ? 28 : 34,
      bearing: nextMode === "columns" ? -9 : -6,
      duration: 700,
    });
  };

  const resetEgyptView = () => {
    mapRef.current?.flyTo({
      center: [EGYPT_VIEW.longitude, EGYPT_VIEW.latitude],
      zoom: mode === "columns" ? 5.1 : EGYPT_VIEW.zoom,
      pitch: mode === "columns" ? 44 : mode === "heat" ? 28 : 34,
      bearing: mode === "columns" ? -9 : -6,
      duration: 900,
    });
  };

  return (
    <div className="relative min-h-[590px] overflow-hidden rounded-xl border border-slate-700 bg-[#070b12]">
      <div
        ref={containerRef}
        className="inset-0"
        style={{ position: "absolute" }}
        aria-label="Interactive dark map of Egypt network performance"
      />

      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-5rem)] rounded-xl border border-white/10 bg-[#080d16]/90 p-2.5 text-white shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          <Control active={mode === "sites"} onClick={() => setMapMode("sites")} icon={MapPin} label="Sites" />
          <Control active={mode === "columns"} onClick={() => setMapMode("columns")} icon={Box} label="3D columns" />
          <Control active={mode === "heat"} onClick={() => setMapMode("heat")} icon={Flame} label="Heat" />
          <span className="mx-1 h-5 w-px bg-white/15" />
          <Layers3 size={13} className="text-slate-400" />
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-slate-100 focus:outline-none"
            aria-label="Map metric"
          >
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
          <span><strong className="text-white">{sites.length}</strong> mapped sites</span>
          <span className={basemapStatus === "offline" ? "text-amber-300" : basemapStatus === "openfree" ? "text-slate-300" : "text-cyan-300"}>
            {basemapStatus === "loading"
              ? "Loading Stadia…"
              : basemapStatus === "stadia"
                ? "Stadia · Alidade Dark"
                : basemapStatus === "openfree"
                  ? "OpenFreeMap fallback"
                  : "Offline fallback"}
          </span>
          {quality && quality.invalidRows > 0 && <span>{fmtNum(quality.invalidRows, 0)} invalid rows</span>}
          {quality && quality.outsideEgyptRows > 0 && <span>{fmtNum(quality.outsideEgyptRows, 0)} outside Egypt</span>}
          {quality?.swappedCoordinates && <span className="font-semibold text-amber-300">Lat/lng order corrected</span>}
        </div>
      </div>

      <button
        onClick={resetEgyptView}
        className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#080d16]/90 px-2.5 py-2 text-[11px] font-bold text-slate-200 shadow-xl backdrop-blur-md hover:text-cyan-300"
      >
        <RotateCcw size={12} /> Reset Egypt view
      </button>

      {selected && (
        <div className="absolute bottom-3 right-3 z-10 w-[min(320px,calc(100%-1.5rem))] rounded-xl border border-white/10 bg-[#080d16]/92 p-3.5 text-white shadow-2xl backdrop-blur-md">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/20 text-fuchsia-300"><MapPin size={15} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold text-white">{selected.entity}</div>
              <div className="text-[10.5px] text-slate-400">{selected.region} · {selected.technology ?? "Technology n/a"}</div>
            </div>
            <button onClick={() => setSelected(null)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X size={13} /></button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px]">
            <Stat label="Average util" value={fmtPct(selected.avgUtil, 1)} />
            <Stat label="Peak util" value={fmtPct(selected.peakUtil, 1)} />
            <Stat label="Risk score" value={selected.riskScore.toFixed(0)} />
            <Stat label="Alarms" value={fmtNum(selected.alarmCount, 0)} />
            <Stat label="Subscribers" value={fmtNum(selected.subscribers, 0)} />
            <Stat label="Coordinates" value={`${selected.latitude.toFixed(3)}, ${selected.longitude.toFixed(3)}`} />
          </div>
          <button
            onClick={() => setFilters({ search: filters.search === selected.entity ? "" : selected.entity })}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-fuchsia-500"
          >
            {filters.search === selected.entity ? <RotateCcw size={12} /> : <Search size={12} />}
            {filters.search === selected.entity ? "Clear site filter" : "Filter dashboard to this site"}
          </button>
        </div>
      )}

      {rendererError && <div className="absolute inset-x-4 bottom-4 z-20 rounded-xl border border-red-400/40 bg-red-950/85 p-3 text-xs text-red-200">{rendererError}</div>}
    </div>
  );
}

function Control({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof MapPin; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold transition-colors ${active ? "bg-fuchsia-600 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-cyan-300"}`}>
      <Icon size={12} /> {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">{label}</div><div className="mt-0.5 truncate font-bold tabular-nums text-white">{value}</div></div>;
}

function highlightBoundaries(map: MapLibreMap): void {
  const boundaryLayers = ["boundary_state", "boundary_country", "boundary_country_z0-4", "boundary_country_z5-"];
  boundaryLayers.forEach((id) => {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, "line-color", id === "boundary_state" ? "#55a9bd" : "#91f2f3");
    map.setPaintProperty(id, "line-opacity", id === "boundary_state" ? 0.38 : 0.82);
  });
}

function addThreeDimensionalBuildings(map: MapLibreMap): void {
  if (!map.getSource("openmaptiles") || map.getLayer("network-3d-buildings")) return;
  const firstLabelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: "network-3d-buildings",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 12,
      filter: ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], ["get", "height"], 0],
          0,
          "#171126",
          25,
          "#4c1d95",
          80,
          "#a855f7",
          160,
          "#67e8f9",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
        "fill-extrusion-opacity": 0.72,
      },
    },
    firstLabelLayer
  );
}

function neonMetricColor(value: number, max: number, alpha: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, value / Math.max(1, max)));
  if (t >= 0.8) return [255, 244, 184, alpha];
  if (t >= 0.6) return [255, 176, 79, alpha];
  if (t >= 0.35) return [249, 102, 114, alpha];
  return [224, 45, 154, alpha];
}

function metricLabel(metric: MetricKey): string {
  return METRICS.find((m) => m.key === metric)?.label ?? metric;
}

function formatMetric(metric: MetricKey, value: number): string {
  if (metric === "avgUtil") return `${value.toFixed(1)}%`;
  return fmtNum(value, 0);
}
