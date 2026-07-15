import { isInsideEgypt } from "@/data/egyptGeography";
import type { EntityStat, GeoQuality, GeoSiteStat } from "@/lib/types";
import type { Frame } from "./frame";

export interface GeospatialResult {
  sites: GeoSiteStat[];
  quality: GeoQuality | null;
}

export function computeGeospatial(frame: Frame, entityStats: EntityStat[]): GeospatialResult {
  if (!frame.latitude || !frame.longitude) return { sites: [], quality: null };

  let directEgypt = 0;
  let swappedEgypt = 0;
  for (let i = 0; i < frame.n; i++) {
    const lat = frame.latitude[i];
    const lng = frame.longitude[i];
    if (lat === null || lng === null) continue;
    if (isInsideEgypt(lat, lng)) directEgypt++;
    if (isInsideEgypt(lng, lat)) swappedEgypt++;
  }
  const swappedCoordinates = swappedEgypt >= 3 && swappedEgypt > directEgypt * 1.35;
  const stats = new Map(entityStats.map((s) => [s.entity, s]));
  const accum = new Map<string, { entity: string; region: string; lat: number; lng: number; count: number }>();
  let validRows = 0;
  let invalidRows = 0;
  let outsideEgyptRows = 0;

  for (let i = 0; i < frame.n; i++) {
    const rawLat = frame.latitude[i];
    const rawLng = frame.longitude[i];
    if (rawLat === null || rawLng === null) {
      invalidRows++;
      continue;
    }
    const latitude = swappedCoordinates ? rawLng : rawLat;
    const longitude = swappedCoordinates ? rawLat : rawLng;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      invalidRows++;
      continue;
    }
    validRows++;
    if (!isInsideEgypt(latitude, longitude)) {
      outsideEgyptRows++;
      continue;
    }
    const entity = frame.entity?.[i] ?? `Site ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    const key = entity || `${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
    const cur = accum.get(key) ?? {
      entity,
      region: frame.region?.[i] ?? "Unassigned",
      lat: 0,
      lng: 0,
      count: 0,
    };
    cur.lat += latitude;
    cur.lng += longitude;
    cur.count++;
    accum.set(key, cur);
  }

  const sites: GeoSiteStat[] = [...accum.values()].map((p) => {
    const stat = stats.get(p.entity);
    return {
      entity: p.entity,
      region: p.region,
      latitude: p.lat / p.count,
      longitude: p.lng / p.count,
      avgUtil: stat?.avgUtil ?? 0,
      peakUtil: stat?.peakUtil ?? 0,
      riskScore: stat?.riskScore ?? 0,
      alarmCount: stat?.alarmCount ?? 0,
      subscribers: stat?.subscribers ?? 0,
      technology: stat?.technology,
      vendor: stat?.vendor,
    };
  });

  const coordinateCounts = new Map<string, number>();
  for (const site of sites) {
    const key = `${site.latitude.toFixed(5)}:${site.longitude.toFixed(5)}`;
    coordinateCounts.set(key, (coordinateCounts.get(key) ?? 0) + 1);
  }
  const duplicateSites = [...coordinateCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  return {
    sites: sites.sort((a, b) => b.riskScore - a.riskScore),
    quality: { validRows, invalidRows, outsideEgyptRows, swappedCoordinates, duplicateSites },
  };
}
