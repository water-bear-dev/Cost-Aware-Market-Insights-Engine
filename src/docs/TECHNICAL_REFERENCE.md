# Technical Reference

This document provides a deep-dive into the core orchestration and quantitative components of the Cost-Aware Market Insights Engine.

## 1. Alpha-DAG Orchestration (`src/dag/`)

The engine's intelligence layer is governed by a Directed Acyclic Graph (DAG) powered by **LangGraph**. This allows for autonomous, non-linear research workflows that can self-correct and enforce budget constraints.

### Key Nodes
- **FinOps Gate**: The mandatory first node. It queries the `CostTracking` ledger to ensure the daily AI budget has not been exhausted. If the budget is hit, the DAG terminates immediately to prevent overspend.
- **Discovery Hunter**: Iterates through the QMJ-ranked universe to identify top candidates based on technical and fundamental criteria.
- **Quant Analyst**: An MCP-driven node that performs technical modeling (RSI, SMA distances, Volatility).
- **Synthesis Node**: The final stage where Claude 3 (via Bedrock) or Llama 3 (via Ollama) generates the investment thesis.

## 2. Model Context Protocol (MCP) Servers (`src/mcp/`)

The engine adopts a distributed tool-use architecture via MCP, isolating heavy compute and data-fetching tasks.

### Market Data Server
- **Role**: Standardizes all interaction with Yahoo Finance.
- **Isolation**: Runs in a sandboxed environment to prevent global state pollution.
- **Capabilities**: Live quote retrieval, historical batch fetching, and fundamental statement extraction.

### Quant Compute Server
- **Role**: Performs heavy numerical analysis using NumPy and Pandas.
- **Benefit**: Offloads CPU-intensive math from the main FastAPI event loop, ensuring the dashboard remains responsive.

## 3. Analytical Warehouse (`src/dbt_qmj/`)

The quantitative engine uses **dbt (data build tool)** to maintain a structured data lakehouse.

### Pipeline Flow
1. **Bronze (Staging)**: Raw `yfinance` JSON data is flattened into `stg_financials`.
2. **Silver (Intermediate)**: `int_qmj_metrics` calculates the raw academic factors (GPA, Leverage, etc.).
3. **Gold (Marts)**: `fct_qmj_screener` computes Z-Scores and the final composite QMJ ranking.

### Environment-Aware Storage
- **Development**: Uses a local **DuckDB** file (`src/dbt_qmj/target/warehouse.duckdb`).
- **Production**: Routes queries to **AWS Athena** over an S3 data lake.

## 4. Cost Tracking & FinOps (`src/cost_tracking/`)

Budget enforcement is handled at the infrastructure level.
- **Unit Costs**: Every AI request is tagged with a USD cost (e.g., $0.0005 for Haiku).
- **Persistence**: Usage is logged to a DynamoDB `DailySpend` table.
- **Precision**: Costs are tracked with Decimal precision to ensure sub-cent accuracy.
