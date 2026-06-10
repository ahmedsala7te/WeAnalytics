import type { AgentDef, PersonaId, RoleId } from "./types";

/* ----------------------------- Thresholds ------------------------------- */

export const THRESHOLDS = {
  utilizationWarning: 80,
  utilizationCongested: 90,
  utilizationCritical: 95,
  saturation: 95,
  chronicMinDays: 5,
  chronicWindowDays: 14,
  slaAvailabilityTarget: 99.9,
  forecastHorizonDays: 30,
  saturationLookaheadDays: 180,
};

/* ------------------------------- Agents --------------------------------- */

export const AGENTS: AgentDef[] = [
  { key: "ingestion", index: 1, name: "Data Ingestion Agent", blurb: "Parsing and normalizing source data" },
  { key: "profiling", index: 2, name: "Data Profiling Agent", blurb: "Inferring column types, quality and semantics" },
  { key: "domain", index: 3, name: "Domain Detection Agent", blurb: "Classifying the business domain" },
  { key: "kpi", index: 4, name: "KPI Discovery Agent", blurb: "Discovering KPIs from the data shape" },
  { key: "telecom", index: 5, name: "Telecom Intelligence Agent", blurb: "Detecting congestion, saturation and risk" },
  { key: "stats", index: 6, name: "Statistical Analysis Agent", blurb: "Trends, correlations and distributions" },
  { key: "forecast", index: 7, name: "Forecasting Agent", blurb: "Projecting capacity and traffic" },
  { key: "rca", index: 8, name: "Root Cause Analysis Agent", blurb: "Explaining what happened and why" },
  { key: "design", index: 9, name: "Dashboard Design Agent", blurb: "Composing persona dashboards" },
  { key: "story", index: 10, name: "Executive Storytelling Agent", blurb: "Writing the executive narrative" },
  { key: "report", index: 11, name: "Report Generation Agent", blurb: "Preparing export channels" },
  { key: "chat", index: 12, name: "AI Chat Assistant Agent", blurb: "Indexing results for Q&A" },
];

/* ------------------------------ Personas -------------------------------- */

export const PERSONAS: { id: PersonaId; label: string; blurb: string }[] = [
  { id: "executive", label: "CTO / Executive", blurb: "Health, risk and strategy" },
  { id: "noc", label: "NOC Operations", blurb: "Live congestion and alarms" },
  { id: "capacity", label: "Capacity Planning", blurb: "Growth and saturation" },
  { id: "performance", label: "Performance", blurb: "Traffic and utilization trends" },
  { id: "assurance", label: "Service Assurance", blurb: "Alarms, SLA and impact" },
];

/* -------------------------------- Roles --------------------------------- */

export const ROLES: { id: RoleId; label: string; description: string; defaultPersona: PersonaId }[] = [
  { id: "cto", label: "CTO / Executive", description: "Strategic network health, risk and investment view", defaultPersona: "executive" },
  { id: "noc", label: "NOC Engineer", description: "Real-time congestion, alarms and critical sites", defaultPersona: "noc" },
  { id: "capacity", label: "Capacity Planner", description: "Growth trends, saturation forecasts, expansion plans", defaultPersona: "capacity" },
  { id: "performance", label: "Performance Engineer", description: "Utilization, traffic and degradation analysis", defaultPersona: "performance" },
  { id: "assurance", label: "Service Assurance", description: "SLA compliance, incidents and service impact", defaultPersona: "assurance" },
  { id: "admin", label: "OSS Administrator", description: "Platform configuration, connectors and governance", defaultPersona: "executive" },
];

/* --------------------------- Chart palettes ----------------------------- */

export const SERIES_COLORS = [
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#0ea5e9",
  "#e11d48",
];

export const STATUS_COLORS = {
  healthy: "#10b981",
  watch: "#06b6d4",
  warning: "#f59e0b",
  critical: "#ef4444",
} as const;

export function utilColor(util: number): string {
  if (util >= 95) return "#ef4444";
  if (util >= 90) return "#f97316";
  if (util >= 80) return "#f59e0b";
  if (util >= 65) return "#06b6d4";
  return "#10b981";
}

export function healthColor(score: number): string {
  if (score >= 90) return "#10b981";
  if (score >= 75) return "#06b6d4";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

export function healthLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 75) return "Stable";
  if (score >= 60) return "Degraded";
  return "Critical";
}

/* --------------------------- Suggested prompts -------------------------- */

export const SUGGESTED_QUESTIONS = [
  "Why is congestion increasing?",
  "Which region is most affected?",
  "Show top 10 congested elements",
  "Predict next month's utilization",
  "When will capacity saturate?",
  "What caused the alarm storm?",
  "Explain the Network Health Score",
  "Generate a CTO report",
];
