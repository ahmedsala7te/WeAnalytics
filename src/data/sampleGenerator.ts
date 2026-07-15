import { Rng } from "@/lib/rng";
import { uid } from "@/lib/format";
import type { Dataset, Row } from "@/lib/types";
import { REGION_CENTERS } from "./egyptGeography";

/* ------------------------------------------------------------------------
 * Synthetic — but operationally realistic — telecom datasets.
 * Patterns intentionally embedded for the intelligence engine to find:
 *  - Alexandria: chronic congestion on 12 MSAN uplinks with fast growth
 *  - Cairo: fiber-cut incident (traffic drop + alarm storm + availability dip)
 *  - Giza: one-night traffic spike (special event)
 *  - Network-wide organic growth with evening busy hour
 * ---------------------------------------------------------------------- */

const REGIONS: { name: string; cities: string[]; msans: number; stress: number }[] = [
  { name: "Cairo", cities: ["Nasr City", "Maadi", "Heliopolis", "Downtown"], msans: 16, stress: 0.62 },
  { name: "Alexandria", cities: ["Smouha", "Miami", "Agami", "Montaza"], msans: 14, stress: 0.78 },
  { name: "Giza", cities: ["Dokki", "Mohandessin", "6th October"], msans: 12, stress: 0.6 },
  { name: "Delta East", cities: ["Mansoura", "Zagazig"], msans: 10, stress: 0.55 },
  { name: "Delta West", cities: ["Tanta", "Damanhour"], msans: 9, stress: 0.52 },
  { name: "Canal", cities: ["Ismailia", "Port Said", "Suez"], msans: 8, stress: 0.5 },
  { name: "Upper Egypt North", cities: ["Minya", "Assiut"], msans: 8, stress: 0.48 },
  { name: "Upper Egypt South", cities: ["Luxor", "Aswan"], msans: 7, stress: 0.45 },
  { name: "Red Sea", cities: ["Hurghada", "Sharm"], msans: 6, stress: 0.56 },
  { name: "North Coast", cities: ["Marsa Matruh", "Alamein"], msans: 5, stress: 0.42 },
];

const REGION_CODE: Record<string, string> = {
  Cairo: "CAI",
  Alexandria: "ALX",
  Giza: "GIZ",
  "Delta East": "DLE",
  "Delta West": "DLW",
  Canal: "CNL",
  "Upper Egypt North": "UEN",
  "Upper Egypt South": "UES",
  "Red Sea": "RDS",
  "North Coast": "NCO",
};

const VENDORS = ["Huawei", "Nokia", "ZTE"];
const TECHS = ["GPON", "VDSL2", "G.Fast"];

/** Evening-peaked daily utilization shape (hour 0..23). */
const DAY_SHAPE = [
  0.62, 0.55, 0.5, 0.47, 0.46, 0.48, 0.54, 0.62, 0.7, 0.74, 0.76, 0.78,
  0.8, 0.79, 0.78, 0.8, 0.83, 0.87, 0.92, 0.97, 1.0, 0.99, 0.9, 0.74,
];

interface MsanDef {
  id: string;
  region: string;
  city: string;
  uplink: string;
  tech: string;
  vendor: string;
  capacity: number;
  subscribers: number;
  baseUtil: number;
  growthPerWeek: number; // % points per week
  chronic: boolean;
  latitude: number;
  longitude: number;
}

function buildFleet(rng: Rng): MsanDef[] {
  const fleet: MsanDef[] = [];
  for (const region of REGIONS) {
    const code = REGION_CODE[region.name];
    const center = REGION_CENTERS[region.name];
    for (let i = 0; i < region.msans; i++) {
      const chronic = region.name === "Alexandria" && i < 12;
      const warm = !chronic && i === 0; // one elevated element per region for realism
      const capacity = rng.pick([1000, 1000, 2500, 10000]);
      const baseUtil = chronic
        ? rng.float(79, 89)
        : warm
          ? rng.float(70, 77)
          : rng.float(34, 36 + region.stress * 52);
      fleet.push({
        id: `${code}-MSAN-${String(i + 1).padStart(3, "0")}`,
        region: region.name,
        city: rng.pick(region.cities),
        uplink: `GE${rng.int(0, 2)}/${rng.int(0, 3)}/${rng.int(1, 8)}`,
        tech: rng.pick(TECHS),
        vendor: rng.pick(VENDORS),
        capacity,
        subscribers: rng.int(600, 3400),
        baseUtil,
        growthPerWeek: chronic ? rng.float(2.2, 3.4) : warm ? rng.float(1.4, 2.2) : rng.float(0.3, 1.7),
        chronic,
        latitude: center.latitude + rng.gauss(0, center.spread * 0.42),
        longitude: center.longitude + rng.gauss(0, center.spread),
      });
    }
  }
  return fleet;
}

export function generateAccessNetworkSample(): Dataset {
  const rng = new Rng(20260610);
  const fleet = buildFleet(rng);
  const days = 28;
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const end = now.getTime();
  const start = end - days * 24 * 3600_000;

  // Incident windows
  const fiberCutStart = end - 10 * 24 * 3600_000 + 11 * 3600_000; // 10 days ago, 11:00
  const fiberCutEnd = fiberCutStart + 6 * 3600_000;
  const cairoCut = fleet.filter((m) => m.region === "Cairo").slice(0, 8);
  const eventNight = end - 3 * 24 * 3600_000; // Giza spike day, evening hours

  const rows: Row[] = [];
  for (const m of fleet) {
    for (let t = start; t < end; t += 3600_000) {
      const d = new Date(t);
      const hour = d.getHours();
      const dow = d.getDay();
      const weeksElapsed = (t - start) / (7 * 24 * 3600_000);
      const weekend = dow === 5 || dow === 6 ? 1.06 : 1.0;

      let util =
        (m.baseUtil + m.growthPerWeek * weeksElapsed) * DAY_SHAPE[hour] * weekend +
        rng.gauss(0, 2.6);

      let availability = 100 - Math.abs(rng.gauss(0, 0.04));
      let critical = 0;
      let alarms = rng.poissonish(0.18 + Math.max(0, util - 78) * 0.045);

      // Cairo fiber cut: traffic collapses, alarm storm, availability dip
      const inCut = t >= fiberCutStart && t < fiberCutEnd && cairoCut.includes(m);
      if (inCut) {
        util *= rng.float(0.25, 0.45);
        alarms += rng.int(18, 42);
        critical += rng.int(4, 11);
        availability = rng.float(62, 88);
      }

      // Giza special event: evening surge
      if (
        m.region === "Giza" &&
        t >= eventNight + 18 * 3600_000 &&
        t <= eventNight + 23 * 3600_000
      ) {
        util *= rng.float(1.22, 1.34);
      }

      util = Math.max(2, Math.min(100, util));
      critical += rng.chance(Math.max(0, util - 93) * 0.012) ? 1 : 0;

      const traffic = (util / 100) * m.capacity;
      const latency = 7.5 + util * 0.14 + Math.max(0, util - 88) * 0.6 + rng.gauss(0, 0.8);
      const loss = Math.max(0, (util - 86) * 0.055 + rng.gauss(0, 0.03));
      availability = Math.max(60, Math.min(100, availability - critical * 0.05));

      rows.push({
        Timestamp: isoHour(t),
        Region: m.region,
        City: m.city,
        Latitude: round5(m.latitude),
        Longitude: round5(m.longitude),
        MSAN_ID: m.id,
        Uplink_Interface: m.uplink,
        Technology: m.tech,
        Vendor: m.vendor,
        Capacity_Mbps: m.capacity,
        Traffic_Mbps: round1(traffic),
        Utilization_Pct: round1(util),
        Subscribers: m.subscribers,
        Active_Alarms: alarms,
        Critical_Alarms: critical,
        Availability_Pct: round2(availability),
        Packet_Loss_Pct: round2(loss),
        Latency_ms: round1(Math.max(3, latency)),
      });
    }
  }

  return {
    id: uid("ds"),
    name: "Access Network — MSAN Uplink Utilization (28 days)",
    source: "sample",
    fileType: "generated",
    uploadedAt: Date.now(),
    rowCount: rows.length,
    columns: Object.keys(rows[0]),
    rows,
  };
}

export function generateCoreLinksSample(): Dataset {
  const rng = new Rng(77001);
  const sites = [
    ["Cairo", "Ramses Core"],
    ["Cairo", "Maadi Core"],
    ["Alexandria", "Sporting Core"],
    ["Giza", "Giza Core"],
    ["Delta East", "Mansoura Edge"],
    ["Delta West", "Tanta Edge"],
    ["Canal", "Ismailia Edge"],
    ["Upper Egypt North", "Assiut Edge"],
    ["Upper Egypt South", "Luxor Edge"],
    ["Red Sea", "Hurghada Edge"],
  ];
  const links: { id: string; region: string; a: string; b: string; cap: number; base: number; growth: number }[] = [];
  let n = 1;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (rng.chance(0.55) && links.length < 40) {
        const hot = links.length % 7 === 0;
        links.push({
          id: `IPC-LNK-${String(n++).padStart(3, "0")}`,
          region: sites[i][0],
          a: sites[i][1],
          b: sites[j][1],
          cap: rng.pick([10000, 40000, 100000]),
          base: hot ? rng.float(68, 80) : rng.float(30, 62),
          growth: hot ? rng.float(1.6, 2.6) : rng.float(0.2, 1.2),
        });
      }
    }
  }
  const days = 90;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = now.getTime();
  const start = end - days * 24 * 3600_000;
  const rows: Row[] = [];
  for (const l of links) {
    for (let t = start; t < end; t += 24 * 3600_000) {
      const weeks = (t - start) / (7 * 24 * 3600_000);
      let util = l.base + l.growth * weeks + rng.gauss(0, 2.2);
      util = Math.max(5, Math.min(100, util));
      rows.push({
        Timestamp: isoHour(t).slice(0, 10),
        Region: l.region,
        Link_ID: l.id,
        A_End_Site: l.a,
        B_End_Site: l.b,
        Capacity_Mbps: l.cap,
        Traffic_Mbps: round1((util / 100) * l.cap),
        Utilization_Pct: round1(util),
        Active_Alarms: rng.poissonish(0.1 + Math.max(0, util - 80) * 0.06),
        Discard_Pct: round2(Math.max(0, (util - 88) * 0.04 + rng.gauss(0, 0.01))),
      });
    }
  }
  return {
    id: uid("ds"),
    name: "IP Core — Backbone Link Utilization (90 days)",
    source: "sample",
    fileType: "generated",
    uploadedAt: Date.now(),
    rowCount: rows.length,
    columns: Object.keys(rows[0]),
    rows,
  };
}

export function generateRetailSample(): Dataset {
  const rng = new Rng(4242);
  const regions = ["Cairo", "Alexandria", "Giza", "Delta", "Canal"];
  const categories = ["Mobile Handsets", "Routers", "Accessories", "SIM & Top-up", "Smart Home"];
  const days = 120;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = now.getTime();
  const start = end - days * 24 * 3600_000;
  const rows: Row[] = [];
  for (let s = 1; s <= 18; s++) {
    const region = regions[s % regions.length];
    const storeBase = rng.float(8000, 32000);
    for (let t = start; t < end; t += 24 * 3600_000) {
      const dow = new Date(t).getDay();
      const weekendBoost = dow === 5 || dow === 6 ? 1.35 : 1;
      const weeks = (t - start) / (7 * 24 * 3600_000);
      const cat = rng.pick(categories);
      const revenue = storeBase * weekendBoost * (1 + 0.012 * weeks) * rng.float(0.6, 1.4);
      rows.push({
        Date: isoHour(t).slice(0, 10),
        Region: region,
        Store_ID: `ST-${String(s).padStart(3, "0")}`,
        Product_Category: cat,
        Units_Sold: Math.round(revenue / rng.float(180, 950)),
        Revenue_EGP: Math.round(revenue),
      });
    }
  }
  return {
    id: uid("ds"),
    name: "Retail — Store Sales (non-telecom demo)",
    source: "sample",
    fileType: "generated",
    uploadedAt: Date.now(),
    rowCount: rows.length,
    columns: Object.keys(rows[0]),
    rows,
  };
}

export interface SampleDef {
  id: string;
  name: string;
  description: string;
  approxRows: string;
  tags: string[];
  build: () => Dataset;
}

export const SAMPLES: SampleDef[] = [
  {
    id: "access",
    name: "Access Network — MSAN Utilization",
    description: "Hourly uplink utilization, traffic, alarms and QoS for ~100 MSANs across 10 regions (28 days). Contains chronic congestion, a fiber-cut alarm storm and a traffic spike.",
    approxRows: "~64K rows · 18 columns",
    tags: ["Telecom", "Performance", "Hourly"],
    build: generateAccessNetworkSample,
  },
  {
    id: "core",
    name: "IP Core — Backbone Links",
    description: "Daily peak utilization for 30–40 backbone links over 90 days with several links trending toward saturation.",
    approxRows: "~3.2K rows · 10 columns",
    tags: ["Telecom", "Capacity", "Daily"],
    build: generateCoreLinksSample,
  },
  {
    id: "retail",
    name: "Retail Sales (non-telecom)",
    description: "Store revenue data — demonstrates automatic domain detection and the generic analytics fallback.",
    approxRows: "~2.2K rows · 6 columns",
    tags: ["Generic", "Sales"],
    build: generateRetailSample,
  },
];

function isoHour(t: number): string {
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round5(x: number): number {
  return Math.round(x * 100000) / 100000;
}
