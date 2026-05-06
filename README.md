# Cost-Aware Market Insights Engine

A fully containerized Python (FastAPI) application designed to ingest stock market data, synthesize it using AI, and surface those insights on a premium frontend dashboard—all while rigorously enforcing strict financial guardrails (FinOps) to guarantee AI generation costs never exceed a daily budget.

![Dashboard Preview](./system-design/system_architecture.png)

## Overview & Architecture Highlights

This project is built around the fundamental philosophy that AI integration must be cost-aware from day one. It utilizes a distributed **Alpha-DAG** system built with LangGraph and the Model Context Protocol (MCP) to ensure modularity, security, and strict financial control.

1. **Data Ingestion via MCP**: `yfinance` logic and Google News RSS extraction are decoupled into a dedicated Market Data MCP server.
2. **Quant Compute Sandbox**: Mathematical calculations (Pandas/Numpy) are executed in a strictly isolated, network-restricted MCP container with zero AWS credentials.
3. **LangGraph Orchestrator**: A Directed Acyclic Graph (DAG) routes tasks, maintains state, and sequences API calls to **AWS Bedrock (Anthropic Claude 3 Haiku)**.
4. **FinOps Engine (DynamoDB)**: An interceptor node in the LangGraph DAG estimates token costs, queries a local `CostTracking` ledger, and physically blocks execution if it would breach your `DAILY_BUDGET_USD` limit.
5. **Daily Discovery Agent**: An autonomous agent that triggers at 8:00 AM AEST to perform mass market analysis and surface "Hidden Gems" on the dashboard.

For a deep dive into the system network design and future Cloud integration plans, review the full [System Design Documentation](./system-design/system_overview.md).

## System Requirements

- **Docker & Docker Compose**: The easiest way to spin up the local DynamoDB ledger alongside the application.
- **AWS Account**: Required for production deployment and invoking the **Amazon Bedrock (Anthropic Claude 3 Haiku)** models.
- **AWS CLI (`aws`)**: Must be configured with `aws configure` locally before running deployment scripts.
- **Python 3.12+**: Required for `langgraph` and `mcp` compatibility.
- **Model Subscriptions**: Ensure that you have requested access to `Anthropic Claude 3 Haiku` inside the AWS Bedrock console in your target region before going live.

## Quick Start (Running Locally)

To run the engine safely on your local machine (where AI synthesis will mock safely instead of hitting AWS):

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Cost-Aware-Market-Insights-Engine.git
   cd Cost-Aware-Market-Insights-Engine
   ```

2. **Start the containers detached:**
   ```bash
   docker-compose up -d --build
   ```
   *This command spins up the backend Python container alongside an `amazon/dynamodb-local` container handling all local storage via standard AWS SDKs (boto3).*

3. **Access the Dashboard:**
   Open your browser to [http://localhost:8000](http://localhost:8000/)
   The engine will automatically populate with real market data. Note the **Daily Discovery Picks** banner at the top, which updates every 24 hours.

## AWS Production Deployment

Deploying the full Alpha-DAG stack to AWS ECS Fargate is handled via automated scripts:

1. **Verify AWS CLI credentials** are loaded (`aws sts get-caller-identity`).
2. **Deploy Infrastructure & Code**:
   ```bash
   sh scripts/deploy.sh
   ```
   *This builds an ARM64-optimized production image, pushes it to ECR, and updates the CloudFormation stack.*
3. **Teardown (Optional)**:
   To remove all AWS resources and return to a local-only setup:
   ```bash
   sh scripts/teardown.sh
   ```

## Project Structure

```text
├── docker-compose.yml       # Local execution with DynamoDB-local
├── Dockerfile               # Multi-stage production environment (ARM64)
├── requirements.txt         # App dependencies (FastAPI, LangGraph, MCP, pytz, etc.)
├── scripts/                 # DevOps automation for AWS Deploy/Teardown
├── static/                  # Glassmorphic frontend dashboard
├── src/                     # Core Alpha-DAG application logic
│   ├── main.py              # Entrypoint & 8 AM AEST Scheduler
│   ├── dag/                 # LangGraph orchestration and Discovery Agent
│   ├── mcp/                 # Market Data and Quant Compute MCP servers
│   ├── cost_tracking/       # FinOps logic and budget gates
│   └── routes/              # Client-facing API v1/v2 endpoints
└── system-design/           # Architecture diagrams and system overview
```

## Phased Rollout Roadmap
- **[COMPLETE] Phase 1: Monolithic System** - Built the foundational FastAPI backend, local DynamoDB ledger, FinOps constraints, and glassmorphic UI.
- **[COMPLETE] Phase 2: Alpha-DAG via MCP** - Deconstructed the monolith into a distributed system governed by a LangGraph orchestrator.
- **[COMPLETE] Phase 3: Daily Discovery Agent** - Integrated an autonomous agent that triggers at 8:00 AM AEST to select top daily picks.
- **[PLANNED] Phase 4: Multi-Agent Collaborative Refinement** - Introducing a specialized "Sentiment Agent" node to ingest alternative data (Reddit/X).

## Development Blog: The Alpha-DAG Pivot

### May 2026: From Monolith to Agentic Discovery
The transition from Phase 1 to Phase 3 represented a significant shift in how we handle financial intelligence. By moving to **LangGraph**, we replaced a brittle background loop with a stateful DAG that can handle complex multi-step reasoning.

The **Daily Discovery Agent** was the crowning achievement of this pivot. Instead of waiting for a user to track a ticker, the system now autonomously "hunts" for value at 8:00 AM every morning. By isolating quantitative math into a restricted **Quant MCP**, we've ensured that our most complex logic runs in a secure sandbox, while Bedrock handles the high-level synthesis only when our **FinOps Gate** confirms we are under budget.

---
*Maintained by the Antigravity Team*
