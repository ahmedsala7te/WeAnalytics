# NetPulse — AI-Powered Telecom Network Intelligence Hub

An enterprise-grade, self-service analytics platform for Telecom OSS environments. Upload any network dataset
(performance counters, utilization exports, alarm dumps) and a 12-agent AI pipeline automatically profiles it,
detects the business domain, discovers KPIs, finds congestion and capacity risks, forecasts saturation, explains
root causes and generates persona-specific executive dashboards — in under 60 seconds, with zero SQL or dashboard
design required.

![Stack](https://img.shields.io/badge/React%2018-TypeScript-3b82f6) ![Charts](https://img.shields.io/badge/Apache-ECharts-8b5cf6) ![Style](https://img.shields.io/badge/Tailwind%20v4-dark--first-0f172a)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-checks then produces dist/
npm run preview    # serve the production build
```

**60-second demo:** sign in (pick the CTO role) → on the Data Hub click **Load & analyze** on
*"Access Network — MSAN Uplink Utilization"* → watch the 12 agents run → **Open dashboards** → switch personas,
click regions on the health map, ask the Copilot *"Why is congestion increasing?"* → export the PDF report.

## What it does

| Capability | How |
|---|---|
| **Ingestion** | CSV / TSV, Excel, JSON, XML, ZIP archives — parsed entirely in-browser (up to 250K rows) |
| **Domain detection** | Column-name + semantic fingerprinting → ranked confidence (Telecom 98%, PM 96%, …) |
| **KPI discovery** | Auto-derives 15+ KPIs (health score, utilization, congestion, headroom, growth, SLA, MTTR-class metrics) with prior-window comparison, sparkline and status |
| **Telecom intelligence** | Congestion (≥90%), chronic congestion (≥5 days / 14-day window), saturation forecasting, alarm storms, SLA violations, subscriber impact |
| **Statistics** | OLS trend regression, Pearson correlation matrix, distribution analysis, rolling z-score anomaly detection |
| **Forecasting** | Holt double-exponential smoothing with 80% confidence band and capacity-exhaustion dates |
| **Root cause analysis** | Pareto concentration, outage signatures (traffic drop + alarm storm + availability dip), growth-vs-capacity, QoS correlation chains |
| **Dashboards** | Five persona bento dashboards (CTO, NOC, Capacity, Performance, Assurance) composed automatically from available artifacts |
| **Storytelling** | Executive headline, summary, key findings, risks and prioritized recommendations — every number computed from the data |
| **AI Copilot** | Conversational Q&A over the analysis (top-N, why, forecast, busy hour, KPI explainers, report generation) |
| **Exports** | Executive PDF, PowerPoint deck, multi-sheet Excel, CSV extracts, per-chart PNG |
| **Governance** | Role-based access (6 roles), audit log, SSO/LDAP/connector integration points documented in-app |

## The 12-agent architecture

```
Upload ─► 1 Ingestion ─► 2 Profiling ─► 3 Domain Detection ─► 4 KPI Discovery
                                                                    │
        8 Root Cause ◄─ 7 Forecasting ◄─ 6 Statistics ◄─ 5 Telecom Intelligence
             │
             ▼
        9 Dashboard Design ─► 10 Storytelling ─► 11 Reporting ─► 12 Chat Assistant
```

Each agent is an isolated module in `src/agents/`. The orchestrator (`orchestrator.ts`) runs them as a pure
pipeline: theatrically paced on upload (so users see the AI work), instantly on filter changes (the same pipeline
re-runs on the filtered subset).

## Hybrid AI: deterministic engine + local LLM (Ollama)

All **numeric** agents are deterministic analytics engines — semantic mapping, threshold intelligence, regression,
exponential smoothing, z-scores. Every number is computed from the uploaded rows; nothing is hallucinated, and the
app runs fully offline (air-gapped OSS friendly).

When a local **Ollama** server is detected (auto-connect to `http://localhost:11434` on startup), two agents
upgrade to LLM mode — still 100% on-device, nothing leaves the machine:

- **Agent 12 — Chat Assistant**: becomes a streaming conversational LLM grounded in a compact analysis digest
  (system-prompt context). The deterministic intent engine still supplies charts and export actions, and remains
  the automatic fallback if Ollama is unreachable or generation fails. Every reply is labeled with its engine.
- **Agent 10 — Executive Storytelling**: after each analysis, the LLM rewrites the executive narrative in the
  background (strict-JSON output, exact-figure grounding rules). Dashboards appear instantly with the template
  narrative; the LLM version replaces it when ready, badged with the model name.

Configure in **Settings → Local AI**: server URL, model picker (auto-ranked — general 3–4B instruct models are
ideal for CPU-only machines), and a toggle for narrative enhancement. The grounding digest is kept stable per
dataset so Ollama's prompt-prefix cache makes follow-up questions much faster than the first one.

```bash
# recommended general-chat models for CPU-only laptops
ollama pull llama3.2:3b
ollama pull qwen2.5:3b-instruct
```

## Project layout

```
src/
  agents/          # the 12 AI agents + orchestrator
  components/      # EChart wrapper, KPI cards, widgets, copilot, filter bar
  components/charts/options.ts   # all ECharts option builders (theme-aware)
  data/            # realistic sample dataset generators (seeded)
  layouts/         # app shell (sidebar + outlet)
  lib/             # types, stats toolkit, constants, formatting, chart registry
  pages/           # Login, Data Hub, Workspace, Connectors, Settings
  store/           # zustand app store (auth, datasets, analyses, filters, chat, audit)
```

## Sample datasets

1. **Access Network — MSAN Uplink Utilization** (~64K rows): hourly utilization/traffic/alarms/QoS for ~100 MSANs
   across 10 Egyptian regions over 28 days. Embedded patterns: 12 chronically congested Alexandria uplinks with
   ~3%/week growth, a Cairo fiber-cut alarm storm, a Giza event-night traffic spike, network-wide organic growth.
2. **IP Core — Backbone Links** (~3.2K rows): 90 days of daily peaks, several links trending to saturation.
3. **Retail Sales** (~2.2K rows): non-telecom data demonstrating domain detection and the generic analytics fallback.

## Uploading real-world exports

The profiling agent handles considerably messy real files:

- **Long format**: any table with a timestamp, element/region dimensions and numeric measures.
- **Wide formats — reshaped automatically (deterministic)**: hourly columns (H0…H23), date-named columns
  ("2026-05-01", "2026-05-02"…), and period-repeated blocks (`report_date_d1, kpi_a_d1, kpi_b_d1, report_date_d2,
  kpi_a_d2…` — e.g. daily "Critical MSANs" reports) are unpivoted into a proper time series before analysis.
- **Multilingual headers/values**: Arabic dictionaries built in (منطقة، قطاع، مشترك، سعة، استغلال، إنذار…).
- **Unit sanity**: a "utilization" column is only trusted if it behaves like a percentage; 0–1 fractions are
  auto-scaled ×100; traffic/capacity pairs derive utilization when no percent column exists.
- **Higher-is-bad measures**: critical/warning minutes, alarms, loss etc. are recognized so rankings, health
  scores, KPI directions and narratives invert correctly.
- **No utilization at all** (assurance extracts): the platform builds a measure-mode report — severity rankings,
  regional breakdown, trend, distribution — instead of pretending congestion analytics apply.
- **LLM Data Understanding agent** (when Ollama is connected): for files the heuristics can't anchor (weak domain
  signal or no usable measure), the local LLM proposes the semantic mapping; every suggestion is validated against
  the actual data before being applied, and the heuristic result stands if the model is wrong.

## Notes & limits

- Datasets live in browser memory for the session (no backend). Connectors page documents the production integration points.
- Authentication is a local RBAC simulation; production deployments federate with AD/LDAP/SSO.
- Tested with Node 18+ (built on Node 24), modern Chromium/Firefox/Edge.
