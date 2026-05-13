# Cost-Aware Market Insights Engine

A fully containerized Python (FastAPI) application designed to ingest stock market data, synthesize it using AI, and surface those insights on a premium frontend dashboard—all while rigorously enforcing strict financial guardrails (FinOps) to guarantee AI generation costs never exceed a daily budget.

The dashboard is structured around three core views:
- **Manage** — A high-signal, institutional-grade terminal focused on **FAANG** assets (or custom watchlists). Features live sparklines, AI synthesis signals, and 24-hour momentum tracking.
- **Screener** — A quantitative powerhouse ranking **600+ tickers** across the S&P 500 and ASX universes using the **Quality Minus Junk (QMJ)** factor model.
- **Discover** — Global market briefing room: regional indices, commodities, top daily movers, and an hourly news feed.
- **Costs / How it Works** — FinOps observability and architecture education.

## System Architecture

```mermaid
flowchart TB
    subgraph Presentation ["Presentation Layer"]
        FastAPI["FastAPI"]
        Dash["Glassmorphic Dashboard"]
        JS["Vanilla JS"]
    end

    subgraph Intelligence ["Alpha-DAG Orchestration (LangGraph)"]
        direction LR
        Gate["FinOps Gate\n(USD Budget Enforcement)"]
        Hunter["Discovery Hunter\n(Global Ticker Filter)"]
        Synth["AI Synthesis"]
        Bedrock["Amazon Bedrock"]

        Gate --> Hunter --> Synth --> Bedrock
    end

    subgraph DataLayer ["Quantitative & Data Layer"]
        direction TB
        MarketMCP["MCP: Market Data\n(Sandboxed Docker)"]
        QuantMCP["MCP: Quant Compute\n(Sandboxed Docker)"]
        DBT["dbt Pipeline\n(QMJ Z-Scores)"]
        Warehouse["Analytics Warehouse\n(DuckDB -> Athena)"]

        MarketMCP --> DBT --> Warehouse
    end

    subgraph Ingestion ["Ingestion"]
        YFinance["Global Market Ingestion\n(yfinance)"]
    end

    subgraph AWS ["AWS Cloud Infrastructure"]
        Fargate["ECS Fargate\n(prod)"]
        Athena["Athena"]
        CW["CloudWatch"]
        DDB_Market[("Market Data")]
        DDB_Insights[("Insights")]
        DDB_Costs[("Cost Tracking")]

        Fargate -.- Athena
        Fargate -.- DDB_Market
        Fargate -.- DDB_Insights
        Fargate -.- DDB_Costs
    end

    %% Connections
    YFinance -- "raw data" --> DBT
    Warehouse -- "QMJ scores" --> Hunter
    QuantMCP -- "QMJ scores" --> Hunter
    Synth -- "insights" --> Dash
    Dash -- "feedback loop" --> Gate
    Gate -- "debit budget" --> DDB_Costs
    
    Fargate -- "runs on" --> Intelligence
    CW -- "observability + alarms" --> Intelligence
    CW -- "observability + alarms" --> AWS

    %% Styling
    classDef intelligence fill:#6a4c93,color:#fff,stroke:#333,stroke-width:2px;
    classDef datalayer fill:#1982c4,color:#fff,stroke:#333,stroke-width:2px;
    classDef aws fill:#ff595e,color:#fff,stroke:#333,stroke-width:2px;
    classDef cost fill:#ffca3a,color:#000,stroke:#333,stroke-width:2px;
    classDef presentation fill:#e0e0e0,color:#000,stroke:#333,stroke-width:2px;

    class Gate,Hunter,Synth,Bedrock intelligence;
    class MarketMCP,QuantMCP,DBT,Warehouse,YFinance datalayer;
    class Fargate,Athena,CW,DDB_Market,DDB_Insights aws;
    class DDB_Costs cost;
    class Presentation presentation;
```

## Overview & Architecture Highlights

The **Cost-Aware Market Insights Engine** is a professional-grade, autonomous financial intelligence platform. It combines agentic AI orchestration (via LangGraph) with a high-performance analytical warehouse (dbt + DuckDB) to provide deep-dive market insights while maintaining strict enterprise-grade budget guardrails.

The engine has now evolved into a **Global Quality Screener**, specializing in **Quality Minus Junk (QMJ)** factor analysis across the S&P 500 and ASX universes.

### 🚀 Key Capabilities

*   **Institutional Dashboard Pivot**: Optimized for high-signal monitoring of elite assets (FAANG by default), decoupling active tracking from broad-market discovery.
*   **Global Discovery Engine (3-Category Model)**: Transformed into a high-conviction global intelligence engine.
    *   **S&P 500 Leader**: Surfacing elite US mega-cap opportunities.
    *   **Global Opportunity**: Expanding into international markets (ASX, LSE, HKEX, NSE, TSX).
    *   **Hidden Gem**: Identifying high-potential mid-cap "quality" candidates.
*   **Autonomous Auto-Healing & Resilience**: A persistent frontend loop monitors AI synthesis states and triggers targeted refinement to ensure analysis is always available without human intervention.
*   **Cost-Aware Targeted Refresh**: Separates cheap real-time market data refreshes (manual button) from expensive AI synthesis (autonomous healing), optimizing token spend.
*   **Institutional Global Dashboard**: Side-by-side comparison across 5+ global exchanges with normalized currency and automated FX conversion.
*   **Agentic Orchestration (Alpha-DAG)**: A multi-agent system powered by LangGraph that autonomously "hunts" for high-quality market opportunities.
*   **FinOps Budget Gates**: Mandatory pre-flight budget checks in the DAG ensure Bedrock/Claude spend never exceeds your daily threshold.
*   **TradingView-UX**: High-density, scrollable terminal dashboard with 24-hour sparklines, multi-timeframe charts, and extended-hours visibility.
*   **Hybrid AI Synthesis**: Seamlessly toggle between AWS Bedrock (Production) and local Ollama/Gemma (Development) models with environment-aware auto-switching.
*   **Analytics Warehouse**: dbt-driven data lakehouse architecture for scalable, reproducible financial modeling.

For a deep dive into the system network design and future Cloud integration plans, review the full [System Design Documentation](./system-design/system_overview.md).

## Quality Minus Junk (QMJ) Methodology

The QMJ Screener evaluates fundamental financial strength based on the "Quality Minus Junk" framework, using data extracted from `yfinance`. The system calculates proxy metrics since standard API data is limited compared to institutional datasets.

**Scoring Methodology:**
Scores are calculated via `dbt` and `DuckDB` (local) or `Athena` (production), converting raw metrics into percentiles (1-100) across the tracked universe using SQL `PERCENT_RANK()`.

1.  **Profitability Score (50%)**: Identifies companies with strong return on capital and cash generation.
    *   *Return on Equity (ROE)*: `net_income / total_stockholder_equity`
    *   *Return on Assets (ROA)*: `net_income / total_assets`
    *   *Cash Flow Margin*: `operating_cash_flow / total_revenue`
2.  **Safety Score (50%)**: Identifies companies with low leverage and default risk.
    *   *Leverage Ratio (Inverse)*: `total_assets / total_debt`

**Total QMJ Score** = `(Profitability Percentile + Safety Percentile) / 2`


## System Requirements

- **Docker & Docker Compose**: The easiest way to spin up the local DynamoDB ledger alongside the application.
- **AWS Account**: Required for production deployment and invoking the **Amazon Bedrock (Anthropic Claude 3 Haiku)** models.
- **AWS CLI (`aws`)**: Must be configured with `aws configure` locally before running deployment scripts.
- **Python 3.9+**: The core engine maintains strict compatibility with Python 3.9 environments, essential for localized institutional deployments.
- **Model Subscriptions**: Ensure that you have requested access to `Anthropic Claude 3 Haiku` inside the AWS Bedrock console in your target region before going live.

## Environment & LLM Support

The engine is designed for **Multi-LLM portability**, allowing you to run powerful open-source models locally during development and scale to enterprise-grade models in the cloud.

| Environment | LLM Provider | Model | Cost | Setup Complexity |
| :--- | :--- | :--- | :--- | :--- |
| **Local** | `ollama` | Llama 3 / 3.2 | Free | Low |
| **Cloud (AWS)** | `bedrock` | Claude 3 Haiku | Pay-as-you-go | Medium |
| **Local (Quick)** | `mock` | Static Mock | Free | Zero |

---

## Quick Start (Running Locally with Ollama)

To run the engine on your local machine using an open-source LLM:

1. **Install Ollama**: Download from [ollama.com](https://ollama.com/) and run it.
2. **Pull a model**:
   ```bash
   ollama pull llama3.2
   ```
3. **Clone the repository**:
   ```bash
   git clone https://github.com/Cost-Aware-Market-Insights-Engine.git
   cd Cost-Aware-Market-Insights-Engine
   ```
4. **Configure for Local Run**:
   Edit `docker-compose.yml` and ensure `LLM_PROVIDER` is set to `ollama`.
5. **Start the containers**:
   ```bash
   docker-compose up -d --build
   ```
6. **Initialize the QMJ Screener**:
   The engine uses dbt Core to calculate analytical scores. Run the following once to set up your local DuckDB instance:
   ```bash
   cd src/dbt_qmj
   dbt run
   cd ../..
   ```
7. **Access the Dashboard**: [http://localhost:8000](http://localhost:8000)

---

## Analytical Warehouse Setup (dbt)

The platform utilizes an **Open Data Lakehouse** pattern. For local development, it uses **DuckDB** which requires no infrastructure.

### Local Development (DuckDB)
The `WarehouseClient` automatically detects your local environment. To update the QMJ scores after adding new tickers:
```bash
cd src/dbt_qmj && dbt run
```

### Production Deployment (AWS Athena)
To enable the cloud-scale warehouse:
1. Set `USE_ATHENA=true` in your environment.
2. Provide your `S3_DATALAKE_BUCKET` name.
3. dbt will automatically route transformations to **AWS Athena** over your S3 data lake.

---

## AWS Production Deployment (Cloud)

To deploy to AWS using Amazon Bedrock and Claude 3 Haiku:

1. **Prerequisites**:
   - AWS Account with **Amazon Bedrock** access requested for `Claude 3 Haiku`.
   - AWS CLI configured (`aws configure`).
2. **Configure for Cloud**:
   Set `LLM_PROVIDER=bedrock` in your production environment variables.
3. **Deploy Infrastructure**:
   ```bash
   sh scripts/deploy.sh
   ```
   *This builds an ARM64-optimized production image, pushes it to ECR, and updates the CloudFormation stack (Fargate + DynamoDB).*
4. **Teardown**:
   ```bash
   sh scripts/teardown.sh
   ```

---

## Configuration Reference

The application behavior is controlled via environment variables (see `src/config.py`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_PROVIDER` | `mock`, `ollama`, or `bedrock` | Auto-detected |
| `ENVIRONMENT`  | `local` or `production` | `local` |
| `OLLAMA_URL` | Endpoint for Ollama API | `http://host.docker.internal:11434` |
| `OLLAMA_MODEL` | Local model to invoke | `llama3.2` |
| `DAILY_BUDGET_USD` | Hard cap on AI spend (Default if DB is empty) | `5.00` |
| `TICKERS` | Comma-separated list of symbols | `AAPL,MSFT,GOOGL,AMZN,META` |
| `DYNAMODB_ENDPOINT_URL`| Point to local DynamoDB (local only) | `None` |

> **Note on Auto-Detection:** If `LLM_PROVIDER` is left blank, the engine will automatically switch to `bedrock` when running in AWS (detected via `AWS_EXECUTION_ENV`) or when `ENVIRONMENT=production`. Otherwise, it defaults to `ollama`.

## Project Structure

```text
├── docker-compose.yml       # Local execution with DynamoDB-local
├── Dockerfile               # Multi-stage production environment (ARM64)
├── requirements.txt         # App dependencies (FastAPI, LangGraph, MCP, pytz, etc.)
├── scripts/                 # DevOps automation for AWS Deploy/Teardown
│   └── syntax_check.sh      # Python, JS, and Docker Compose syntax validator
├── static/                  # Glassmorphic frontend dashboard
├── src/                     # Core Alpha-DAG application logic
│   ├── main.py              # Entrypoint & 8 AM AEST Scheduler
│   ├── dag/                 # LangGraph orchestration and Discovery Agent
│   ├── mcp/                 # Market Data and Quant Compute MCP servers
│   ├── cost_tracking/       # FinOps logic and budget gates
│   └── routes/              # Client-facing API v1/v2 endpoints
│       ├── discover.py      # Market indices, movers & news endpoints
│       └── meta.py          # Exchange rates endpoint
└── system-design/           # Architecture diagrams and system overview
```

## Phased Rollout Roadmap
- **[COMPLETE] Phase 1: Monolithic System** - Built the foundational FastAPI backend, local DynamoDB ledger, FinOps constraints, and glassmorphic UI.
- **[COMPLETE] Phase 2: Alpha-DAG via MCP** - Deconstructed the monolith into a distributed system governed by a LangGraph orchestrator.
- **[COMPLETE] Phase 3: Daily Discovery Agent** - Integrated an autonomous agent that triggers at 8:00 AM AEST to select top daily picks.
- **[COMPLETE] Phase 4: UX Polish & Global Access** - Multi-currency support, interactive visualizations, live discovery pick hydration, and educational infrastructure animations.
- **[COMPLETE] Phase 5: Discover & Manage Redesign** - Restructuring the dashboard navigation into dedicated Manage (tracked assets) and Discover (global market intelligence) tabs. Adding regional indices, commodities, top movers, and a live news feed.
- **[COMPLETE] Phase 6: Global Localization & Resilience** - Multi-currency support (HKD, CAD, SGD, NZD), exchange-aware price formatting, and robust local LLM (Ollama) stability patches for the Discovery Agent.
- **[COMPLETE] Phase 8: Global Quality Screener & Institutional Pivot** - Integrated S&P 500 and ASX universe toggle for the QMJ Screener, implemented a resilient "permissive" ingestion engine with quarterly fallbacks, and executed an institutional pivot to focus the dashboard on FAANG assets while isolating the 600-ticker screener logic.
- **[COMPLETE] Phase 9: Discovery Agent Revamp & Institutional Intelligence** - Implementing a 12-hour refresh cycle (8 AM/8 PM AEST), high-conviction AI investment theses, and direct news integration within discovery picks. Added "Add to Watchlist" functionality directly in modal views for seamless asset acquisition.
- **[PLANNED] Phase 10: Multi-Agent Collaborative Refinement** - Introducing specialized "Sentiment Agent" nodes to ingest alternative data (Reddit/X).


---

## Project Tracking

- **[Development Blog](./dev-blog/DEVELOPMENT_BLOG.md)** — Architectural pivots and engineering journals.
- **[Changelog](./CHANGELOG.md)** — Version-by-version feature updates and bug fixes.

---

## License
MIT License - See [LICENSE](LICENSE) for details.
