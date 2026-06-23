import type { ColumnProfile, DomainScore, SemanticMapping } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Agent 3 — Domain Detection
 * Fingerprints column names + semantics against domain signatures and
 * produces ranked confidence scores.
 * ---------------------------------------------------------------------- */

interface DomainSignature {
  domain: string;
  keywords: RegExp[];
  semanticBoost: { tag: string; weight: number }[];
}

const SIGNATURES: DomainSignature[] = [
  {
    domain: "Telecom",
    keywords: [
      /msan|dslam|olt|onu|gpon|vdsl/i,
      /bts|enodeb|gnodeb|cell|sector|rnc|bsc/i,
      /traffic|throughput|mbps|gbps|erlang/i,
      /util|occupanc|استغلال|اشغال/i,
      /alarm|trap|netcool|proviso|انذار|إنذار/i,
      /link|interface|uplink|backhaul|transmission/i,
      /subscriber|imsi|msisdn|مشترك/i,
      /latency|jitter|packet|rssi|sinr|bler/i,
      /vendor|huawei|nokia|ericsson|zte/i,
      /availability|uptime|outage/i,
      /hostname|exchange|سنترال|قطاع|منطقة/i,
      /upgrade|capacity|سعة/i,
      /\d+\s?mbps|\d+\s?gbps|broadband|fiber|fibre|ftth|gpon|adsl|vdsl|dsl/i,
      /service\s?plan|tariff|tier|package/i,
    ],
    semanticBoost: [
      { tag: "utilization", weight: 18 },
      { tag: "traffic", weight: 14 },
      { tag: "capacity", weight: 10 },
      { tag: "alarms", weight: 12 },
      { tag: "entity", weight: 6 },
      { tag: "availability", weight: 8 },
      { tag: "latency", weight: 8 },
      { tag: "packet_loss", weight: 8 },
      { tag: "subscribers", weight: 8 },
    ],
  },
  {
    domain: "Performance Management",
    keywords: [/util|occupanc|peak|busy/i, /throughput|traffic/i, /latency|delay|loss/i, /kpi|counter|measurement/i, /availability/i],
    semanticBoost: [
      { tag: "utilization", weight: 22 },
      { tag: "traffic", weight: 12 },
      { tag: "latency", weight: 10 },
      { tag: "packet_loss", weight: 10 },
      { tag: "timestamp", weight: 6 },
    ],
  },
  {
    domain: "Capacity Planning",
    keywords: [/capacity|headroom|saturation/i, /growth|forecast/i, /util/i, /bandwidth/i, /subscriber/i],
    semanticBoost: [
      { tag: "capacity", weight: 24 },
      { tag: "utilization", weight: 14 },
      { tag: "traffic", weight: 10 },
      { tag: "subscribers", weight: 8 },
    ],
  },
  {
    domain: "Service Assurance",
    keywords: [
      /alarm|fault|trap|incident|ticket|انذار|إنذار|عطل/i,
      /severity|critical|major|minor/i,
      /sla|mttr|outage/i,
      /clear|ack/i,
      /critical.?time|warning.?time|down.?time|degrad/i,
      /reason|status|upgrade/i,
    ],
    semanticBoost: [
      { tag: "alarms", weight: 24 },
      { tag: "critical_alarms", weight: 16 },
      { tag: "severity", weight: 14 },
      { tag: "availability", weight: 10 },
      { tag: "entity", weight: 6 },
      { tag: "subscribers", weight: 6 },
    ],
  },
  {
    domain: "Operations",
    keywords: [/site|node|region|zone/i, /status|state/i, /ticket|workorder|crew/i],
    semanticBoost: [
      { tag: "entity", weight: 10 },
      { tag: "region", weight: 8 },
      { tag: "timestamp", weight: 4 },
    ],
  },
  {
    domain: "Customer Experience",
    keywords: [/nps|csat|complaint|churn|mos/i, /customer|subscriber/i, /experience|qoe/i],
    semanticBoost: [{ tag: "subscribers", weight: 10 }],
  },
  {
    domain: "Finance",
    keywords: [/revenue|cost|opex|capex|budget|invoice|egp|usd|eur/i, /margin|profit/i, /price/i],
    semanticBoost: [{ tag: "revenue", weight: 26 }],
  },
  {
    domain: "Sales",
    keywords: [/sales|order|units|sold|store|product|category/i, /pipeline|deal|quota/i],
    semanticBoost: [
      { tag: "revenue", weight: 16 },
      { tag: "quantity", weight: 14 },
    ],
  },
];

export function detectDomains(profile: ColumnProfile[], mapping: SemanticMapping): DomainScore[] {
  // fingerprint includes a few sample VALUES, not just column names — this lets
  // value patterns like "30Mbps", "GPON" or "active" inform the domain.
  const colNames =
    profile.map((p) => p.name).join(" | ") +
    " || " +
    profile.flatMap((p) => p.samples.slice(0, 3)).join(" | ");
  const scores: DomainScore[] = SIGNATURES.map((sig) => {
    let score = 0;
    let hits = 0;
    for (const kw of sig.keywords) {
      if (kw.test(colNames)) {
        hits++;
        score += 9;
      }
    }
    for (const boost of sig.semanticBoost) {
      if (profile.some((p) => p.semantic === boost.tag)) score += boost.weight;
    }
    // coverage bonus when several distinct keyword families hit
    if (hits >= 4) score += 12;
    if (hits >= 6) score += 8;
    return { domain: sig.domain, confidence: Math.min(99, Math.round(score)) };
  });

  // Generic fallback floor
  const hasMeasure = mapping.measures.length > 0;
  scores.push({ domain: "Generic Business", confidence: hasMeasure ? 35 : 20 });

  scores.sort((a, b) => b.confidence - a.confidence);

  // Normalize the leader into a believable 60–99 band when strong
  if (scores[0].confidence > 99) scores[0].confidence = 99;
  return scores.slice(0, 5);
}

export function isTelecomDomain(domains: DomainScore[]): boolean {
  const telecomish = ["Telecom", "Performance Management", "Capacity Planning", "Service Assurance"];
  const top = domains[0];
  return telecomish.includes(top.domain) && top.confidence >= 45;
}
