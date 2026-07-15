import type { FeatureCollection, Polygon } from "geojson";

/** Compact outline retained for offline/geospatial utilities. */
export const EGYPT_OUTLINE: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Egypt", kind: "country" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [24.7, 31.58], [26.0, 31.55], [27.2, 31.48], [28.5, 31.24],
          [29.2, 30.95], [29.8, 31.22], [30.7, 31.5], [31.55, 31.57],
          [32.25, 31.28], [33.05, 31.02], [34.22, 31.32], [34.52, 29.62],
          [34.9, 29.0], [34.65, 28.25], [34.25, 27.72], [34.42, 26.55],
          [34.7, 25.0], [35.0, 22.0], [31.0, 22.0], [27.0, 22.0],
          [24.7, 22.0], [24.7, 31.58],
        ]],
      },
    },
  ],
};

export const EGYPT_VIEW = {
  longitude: 30.65,
  latitude: 26.75,
  zoom: 4.5,
  pitch: 8,
  bearing: 0,
} as const;

export const REGION_CENTERS: Record<string, { latitude: number; longitude: number; spread: number }> = {
  Cairo: { latitude: 30.0444, longitude: 31.2357, spread: 0.16 },
  Alexandria: { latitude: 31.2001, longitude: 29.9187, spread: 0.13 },
  Giza: { latitude: 30.0131, longitude: 31.2089, spread: 0.18 },
  "Delta East": { latitude: 31.0409, longitude: 31.3785, spread: 0.25 },
  "Delta West": { latitude: 30.7865, longitude: 30.999, spread: 0.24 },
  Canal: { latitude: 30.5965, longitude: 32.2715, spread: 0.28 },
  "Upper Egypt North": { latitude: 28.35, longitude: 30.86, spread: 0.38 },
  "Upper Egypt South": { latitude: 25.69, longitude: 32.64, spread: 0.48 },
  "Red Sea": { latitude: 27.26, longitude: 33.81, spread: 0.42 },
  "North Coast": { latitude: 31.35, longitude: 27.25, spread: 0.42 },
};

export function isInsideEgypt(latitude: number, longitude: number): boolean {
  return latitude >= 21.5 && latitude <= 31.9 && longitude >= 24.2 && longitude <= 37.2;
}
