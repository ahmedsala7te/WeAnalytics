import { describe, expect, it } from "vitest";
import { generateAccessNetworkSample } from "@/data/sampleGenerator";
import type { Dataset } from "@/lib/types";
import { runPipeline } from "./orchestrator";

describe("Egypt geospatial intelligence", () => {
  it("detects sample coordinates and creates one map site per MSAN", async () => {
    const dataset = generateAccessNetworkSample();
    const analysis = await runPipeline(dataset);

    expect(analysis.mapping.latitude).toBe("Latitude");
    expect(analysis.mapping.longitude).toBe("Longitude");
    expect(analysis.geoSites).toHaveLength(95);
    expect(analysis.geoQuality?.validRows).toBe(dataset.rowCount);
    expect(analysis.geoQuality?.invalidRows).toBe(0);
    expect(analysis.dashboards.some((d) => d.widgets.some((w) => w.type === "geo-map-3d"))).toBe(true);
  });

  it("corrects a clearly swapped latitude/longitude pair", async () => {
    const rows = [
      { Timestamp: "2026-07-13 10:00", Site_ID: "RDS-1", Region: "Red Sea", Latitude: 33.81, Longitude: 27.26, Utilization_Pct: 82 },
      { Timestamp: "2026-07-13 11:00", Site_ID: "RDS-2", Region: "Red Sea", Latitude: 34.02, Longitude: 27.41, Utilization_Pct: 91 },
      { Timestamp: "2026-07-14 10:00", Site_ID: "RDS-3", Region: "Red Sea", Latitude: 33.63, Longitude: 26.95, Utilization_Pct: 74 },
    ];
    const dataset: Dataset = {
      id: "swapped-coordinates",
      name: "Swapped coordinates",
      source: "upload",
      fileType: "csv",
      uploadedAt: Date.now(),
      rows,
      rowCount: rows.length,
      columns: Object.keys(rows[0]),
    };

    const analysis = await runPipeline(dataset);
    expect(analysis.geoQuality?.swappedCoordinates).toBe(true);
    expect(analysis.geoSites).toHaveLength(3);
    expect(analysis.geoSites[0].latitude).toBeLessThan(32);
    expect(analysis.geoSites[0].longitude).toBeGreaterThan(32);
  });
});
