# AI Market Insights Engine -- Final System Architecture

## Final Production State (Phase 8 Complete)
**Status:** Institutional-Grade QMJ Screener & Alpha-DAG Pivot [COMPLETE]

### 1. High-Level Architecture
The system has evolved from a monolithic background loop to a **stateful, agentic discovery engine** orchestrated via **LangGraph**. It combines institutional-grade factor analysis (QMJ) with cost-aware AI synthesis.

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
The engine leverages a distributed agentic architecture (Alpha-DAG) combined with a high-performance analytical warehouse.

*   **Orchestration**: LangGraph (Alpha-DAG) for stateful multi-agent workflows.
*   **AI Synthesis**: AWS Bedrock (Claude 3 Haiku) or local Ollama (Llama 3.2).
*   **Analytical Warehouse**: dbt Core + DuckDB (Local) / AWS Athena (Cloud).
*   **Screener Model**: Quality Minus Junk (QMJ) 5-Factor Z-Score Analysis.
*   **Persistence**: DynamoDB (Tables: MarketData, Tickers, Insights, CostTracking).
*   **Frontend**: Vanilla JS (Diff-Patch Renderer) + Chart.js + CSS Grid.

### 2. Tangible Milestones & Roadmap

#### Phase 1: Local FinOps MVP (Completed)
- [x] Python APScheduler + yfinance ingestion logic.
- [x] Pydantic schemas + DynamoDB-local integration.
- [x] Logic-driven AI Synthesis Mocking with local budget gates.

#### Phase 2: Cloud Synthesis (Completed)
- [x] AWS Bedrock (Anthropic Claude 3 Haiku) integration.
- [x] Production IAM task roles + ECR containerization.
- [x] Infrastructure-as-Code via CloudFormation.

#### Phase 3: Alpha-DAG Orchestration (Completed)
- [x] Transition from loops to LangGraph stateful orchestrator.
- [x] Implementation of the "Discovery Agent" node.
- [x] Model Context Protocol (MCP) isolation for Quant Compute.

#### Phase 4: Discovery & Portfolio (Completed)
- [x] Real-time Search & Autocomplete proxy for Yahoo Finance.
- [x] 24-hour Sparklines + Interactive Portfolio Area Chart.
- [x] Daily Discovery Agent: S&P 500 "Hidden Gem" analysis.

#### Phase 5: Global Intelligence (Completed)
- [x] Multi-tab navigation: Manage vs. Discover.
- [x] Global Discovery Hub (Indices, Commodities, Movers, News).
- [x] Pre/Post-Market Price Visibility + Cron-driven hydration.

#### Phase 8: Global Quality Screener & Institutional Pivot (Completed)
- [x] Integration of dbt-DuckDB for analytical modeling across 600+ tickers.
- [x] Implementation of 5-Factor QMJ Model (Profitability, Growth, Safety, Valuation, Momentum).
- [x] Universal Screen (S&P 500 + ASX comparison) with sticky-header scrollable UI.
- [x] **Institutional Pivot**: Decoupled "Broad Screening" from "Active Monitoring".
- [x] Focused FAANG-centric dashboard for high-signal daily tracking.
- [x] Python 3.9 compatibility hardening for institutional runtime environments.

### 3. Advanced Engine Architecture

#### A. Alpha-DAG Intelligence (LangGraph)
The core intelligence is orchestrated via a stateful Directed Acyclic Graph (DAG) replacing legacy background loops.
- **FinOps Gate Node**: Heuristic check of spend vs budget ($5.00/day threshold) before any LLM invocation.
- **Discovery Hunter**: Autonomous daily search for value across global tickers.
- **Synthesis Node**: Claude 3 Haiku via Bedrock for narrative generation with temperature calibration (0.3).
- **State Persistence**: DAG state is saved to DynamoDB for "resume-from-checkpoint" reliability.

#### B. Institutional QMJ Screener
The **Quality Minus Junk (QMJ)** engine implements the AQR factor strategy to rank stocks across universes.
- **Three Pillars of Quality**:
    - **Profitability**: GPOA, ROE, and Gross Margin.
    - **Growth**: 5-year growth in profitability metrics.
    - **Safety**: Volatility, Leverage, and Bankruptcy risk (O-Score).
- **Transformation Pipeline**: Managed via `dbt`, transforming raw fundamental data into normalized Z-scores.
- **Multi-Universe**: Separate logic for **S&P 500 (US)** and **ASX (Australia)**.
- **Warehouse client**: Uses DuckDB for low-latency local dashboard analytics and Athena for production historical runs.

#### C. Force Refresh Engine
- **Throttling**: Integrated a global "Force Refresh" button with a 30-second client-side cooldown to manage data ingestion load.
- **Scope**: Refreshes ticker prices and news headlines without triggering expensive QMJ re-calculations (only quarterly).

### 4. Component Isolation (MCP)
To maintain security and execution isolation, external capabilities are decoupled into independent **Model Context Protocol (MCP)** servers:
1. **Market Data MCP**: Encapsulates `yfinance` logic and Google News RSS parsing.
2. **Quant Compute MCP**: A network-restricted Docker container running Pandas/Numpy for heavy math, completely insulated from AWS credentials.

### 5. Project Structure
```text
market-insights-engine/
├── Dockerfile                        # Multi-stage Docker build
├── infra/                            # CloudFormation & Deployment configs
├── system-design/                    # Diagrams & System Overviews
├── dev-blog/                         # Architectural decision logs
├── src/
│   ├── main.py                       # FastAPI entry point
│   ├── dag/                          # LangGraph state machine & nodes
│   ├── dbt_qmj/                      # dbt models for Quality-Minus-Junk
│   ├── mcp/                          # MCP servers (Quant, Market)
│   ├── cost_tracking/                # FinOps Budget Gate
│   ├── routes/                       # API Endpoints (Insights, Screener, Costs)
│   ├── clients/                      # AWS (Dynamo, Bedrock) & Warehouse (DuckDB)
│   └── models.py                     # Pydantic data schemas
└── static/                           # Glassmorphic Frontend Dashboard
```

### 6. Networking & Security
- **Private Subnet**: The application is fully isolated; no public IP is assigned to the Fargate container.
- **Inbound**: Traffic permitted only from the Application Load Balancer (ALB).
- **Outbound**: All external traffic (Yahoo Finance, News) routes via a **NAT Gateway**.
- **Internal**: DynamoDB traffic stays within the AWS backbone via **VPC Gateway Endpoints** (Cost: $0.00).
