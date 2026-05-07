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
6. **Access the Dashboard**: [http://localhost:8000](http://localhost:8000)

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
| `DAILY_BUDGET_USD` | Hard cap on AI spend (FinOps) | `5.00` |
| `TICKERS` | Comma-separated list of symbols | `AAPL,MSFT,GOOGL,AMZN,META` |
| `DYNAMODB_ENDPOINT_URL`| Point to local DynamoDB (local only) | `None` |

> **Note on Auto-Detection:** If `LLM_PROVIDER` is left blank, the engine will automatically switch to `bedrock` when running in AWS (detected via `AWS_EXECUTION_ENV`) or when `ENVIRONMENT=production`. Otherwise, it defaults to `ollama`.

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
- **[COMPLETE] Phase 4: UX Polish & Global Access** - Integrated multi-currency support, interactive visualizations, live discovery pick hydration, and educational infrastructure animations. Structured all AI insights into a 2-point "Investment Assistant" format.
- **[PLANNED] Phase 5: Multi-Agent Collaborative Refinement** - Introducing specialized "Sentiment Agent" nodes to ingest alternative data (Reddit/X).

## Development Blog: The Alpha-DAG Pivot

### May 2026: From Monolith to Agentic Discovery
The transition from Phase 1 to Phase 3 represented a significant shift in how we handle financial intelligence. By moving to **LangGraph**, we replaced a brittle background loop with a stateful DAG that can handle complex multi-step reasoning.

The **Daily Discovery Agent** was the crowning achievement of this pivot. Instead of waiting for a user to track a ticker, the system now autonomously "hunts" for value at 8:00 AM every morning. By isolating quantitative math into a restricted **Quant MCP**, we've ensured that our most complex logic runs in a secure sandbox, while Bedrock handles the high-level synthesis only when our **FinOps Gate** confirms we are under budget.

### May 2026: The Colima Networking Incident
**Problem:** After a successful `docker-compose up --build`, the dashboard was completely unreachable at `localhost:8000`. `curl` returned `Connection refused` even though `docker ps` showed the container as `healthy`. The `lsof -i :8000` command returned nothing — no process was listed as the owner of the port.

**Root Cause:** The project runs Docker via **Colima** (a lightweight macOS Docker runtime alternative to Docker Desktop). In Colima's default mode, it runs a Linux VM using Apple's Virtualization Framework without assigning it a host-bridged network interface. Port bindings like `0.0.0.0:8000->8000/tcp` are forwarded *inside* the Colima VM, but are not exposed to the macOS host network. This is why `localhost` and `127.0.0.1` both silently refused connections.

**Fix:** Restart Colima with the `--network-address` flag, which provisions a dedicated bridged network interface and assigns the VM a stable LAN IP:
```bash
colima stop
colima start --network-address
# Then check your IP:
colima list  # Shows ADDRESS column, e.g. 192.168.64.2
```
The dashboard is then accessible at `http://192.168.64.2:8000` (use your specific Colima IP).

**Lesson:** When debugging container connectivity issues on macOS, always check the Docker runtime first (`docker context ls`). If it points to a Colima socket, `localhost` port forwarding behaves differently than Docker Desktop.

---
*Maintained by the Antigravity Team*
