# System Mapping

This document maps the structural organization, data flow, and request lifecycles of the Cost-Aware Market Insights Engine.

## 1. Directory Structure

```text
├── src/
│   ├── main.py              # Application Entrypoint & Background Scheduler
│   ├── config.py            # Environment-aware configuration (Pydantic)
│   ├── models.py            # Shared Pydantic schemas (Tickers, Insights)
│   ├── clients/             # AWS and Warehouse connection wrappers
│   ├── ingestion/           # Real-time yfinance fetching & headline scraping
│   ├── dag/                 # LangGraph Intelligence Orchestration
│   ├── mcp/                 # Model Context Protocol micro-servers
│   ├── cost_tracking/       # FinOps budget gate logic
│   ├── synthesis/           # AI Prompt engineering and LLM routing
│   ├── dbt_qmj/             # Quantitative factor models (dbt)
│   └── routes/              # Client-facing API Endpoints (v1/v2)
├── static/                  # Vanilla JS Frontend (SWR pattern)
├── infra/                   # CloudFormation and Docker definitions
└── docs/                    # Architectural & Technical documentation
```

## 2. Request Lifecycle

### Frontend Request (e.g., Get Discovery Picks)
1. **User Action**: Dashboard switches to "Discover" tab.
2. **API Call**: Frontend hits `GET /api/v1/discover/picks`.
3. **Cache Check**: Backend checks the `DiscoveryLedger` DynamoDB table for recent picks.
4. **DAG Trigger (If Stale)**: 
   - If picks are >12 hours old, the **Alpha-DAG** is invoked.
   - **Gate**: Checks budget in `CostTracking`.
   - **Hunt**: Queries `fct_qmj_screener` for top-tier candidates.
   - **Synth**: Calls Bedrock/Ollama for thesis generation.
5. **Response**: JSON payload returned to frontend for rendering.

### Background Sync (Heartbeat)
1. **Trigger**: Background Scheduler (APScheduler) fires every 5 minutes.
2. **Fetch**: `ingestion/service.py` loops through all `TrackedAssets`.
3. **Enrich**: Headlines scraped, Pre/Post market prices captured.
4. **Store**: Latest state saved to the `MarketData` DynamoDB ledger.
5. **Notify**: Frontend (via 15s polling) detects changes and performs a DOM "diff-and-patch" update.

## 3. Data Flow Architecture

### Quantitative Intelligence Flow
`Yahoo Finance` → `yfinance` → `Bronze S3/DuckDB` → `dbt Run` → `Z-Score Logic` → `QMJ Ranking` → `Discovery Agent Selection`

### Insight Synthesis Flow
`Market Events` → `Headline Scraping` → `Alpha-DAG Context Injection` → `LLM (Claude/Llama)` → `Structured Insights` → `DynamoDB` → `Dashboard`

### FinOps Guardrail Flow
`UI Request` → `FinOps Gate` → `DynamoDB Budget Check` → `Allow/Deny Execution` → `Debit Usage Post-Synthesis`
