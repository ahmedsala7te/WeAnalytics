import { buildDataUnderstanding, selectBusinessCase } from "./dataUnderstanding";
import { buildTelecomPlaybookPlan } from "./telecomBusinessCases";
import { validateDashboardPlan } from "@/llm/dashboardPlanner";
import type { Dataset, TelecomBusinessCaseId } from "@/lib/types";

interface RegressionFixture {
  name: string;
  expectedCaseId: TelecomBusinessCaseId;
  dataset: Dataset;
}

interface RegressionResult {
  name: string;
  passed: boolean;
  checks: string[];
}

const now = Date.UTC(2026, 5, 20);

const fixtures: RegressionFixture[] = [
  {
    name: "critical warning time comparison",
    expectedCaseId: "critical_time_comparison",
    dataset: ds("critical-time", ["Date", "MSAN", "Region", "Sector", "Average Critical Time", "Average Warning Time", "Subscribers"], [
      ["2026-06-18", "MSAN-001", "Cairo", "East", 20, 12, 5000],
      ["2026-06-19", "MSAN-001", "Cairo", "East", 38, 15, 5000],
      ["2026-06-20", "MSAN-001", "Cairo", "East", 60, 21, 5000],
      ["2026-06-18", "MSAN-002", "Giza", "West", 5, 7, 2400],
      ["2026-06-19", "MSAN-002", "Giza", "West", 4, 6, 2400],
      ["2026-06-20", "MSAN-002", "Giza", "West", 3, 5, 2400],
    ]),
  },
  {
    name: "subscriber impact",
    expectedCaseId: "subscriber_impact",
    dataset: ds("subscriber-impact", ["Date", "MSAN", "Region", "Subscribers Impacted", "Fault Duration"], [
      ["2026-06-20", "MSAN-101", "Alex", 12000, 45],
      ["2026-06-20", "MSAN-102", "Cairo", 7000, 20],
      ["2026-06-20", "MSAN-103", "Giza", 3000, 10],
    ]),
  },
  {
    name: "upgrade follow-up",
    expectedCaseId: "upgrade_followup",
    dataset: ds("upgrade-followup", ["MSAN", "Region", "Upgrade Status", "Subscribers", "Capacity"], [
      ["MSAN-201", "Cairo", "Solved", 8000, 100],
      ["MSAN-202", "Cairo", "Not In Plan", 4200, 80],
      ["MSAN-203", "Giza", "Cancelled", 3000, 60],
    ]),
  },
  {
    name: "congestion utilization risk",
    expectedCaseId: "congestion_risk",
    dataset: ds("congestion-risk", ["Timestamp", "Link", "Region", "Utilization %", "Capacity Mbps"], [
      ["2026-06-20 09:00", "LINK-1", "Cairo", 91, 1000],
      ["2026-06-20 10:00", "LINK-1", "Cairo", 96, 1000],
      ["2026-06-20 09:00", "LINK-2", "Giza", 74, 500],
    ]),
  },
  {
    name: "alarm assurance",
    expectedCaseId: "alarm_assurance",
    dataset: ds("alarm-assurance", ["Timestamp", "Node", "Region", "Alarm Count", "Critical Alarm Count"], [
      ["2026-06-20 09:00", "NODE-1", "Cairo", 30, 8],
      ["2026-06-20 10:00", "NODE-1", "Cairo", 45, 12],
      ["2026-06-20 09:00", "NODE-2", "Giza", 12, 1],
    ]),
  },
];

export function runBusinessDashboardRegressionFixtures(): RegressionResult[] {
  return fixtures.map((fixture) => {
    const checks: string[] = [];
    const report = buildDataUnderstanding(fixture.dataset);
    const selected = selectBusinessCase(report, fixture.expectedCaseId);
    const detected = report.businessContext.candidates.some((c) => c.id === fixture.expectedCaseId);
    if (detected) checks.push("expected business case was detected as a candidate");
    const playbook = buildTelecomPlaybookPlan(selected, fixture.expectedCaseId, "regression fixture");
    if (playbook.widgets.some((w) => w.type === "kpi-grid" && w.dataKey === `business:${fixture.expectedCaseId}`)) {
      checks.push("playbook uses a business KPI pack");
    }
    const sparse = validateDashboardPlan({ title: "Sparse", widgetPatches: [], extraWidgets: [{ type: "made-up-widget", title: "Bad" }] } as Parameters<typeof validateDashboardPlan>[0], selected, "regression fixture", "fixture");
    if (sparse.widgets.length >= playbook.widgets.length && sparse.widgets.some((w) => w.type === "dashboard-reasoning")) {
      checks.push("weak LLM output preserved the playbook layout");
    }
    return { name: fixture.name, passed: checks.length === 3, checks };
  });
}

function ds(name: string, columns: string[], values: (string | number)[][]): Dataset {
  return {
    id: `fixture-${name}`,
    name,
    source: "sample",
    fileType: "csv",
    sizeBytes: values.length * columns.length * 8,
    uploadedAt: now,
    columns,
    rowCount: values.length,
    rows: values.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i] ?? null]))),
  };
}
