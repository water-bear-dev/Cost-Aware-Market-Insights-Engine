# Agent Handoff: HKUDS Vibe-Trading Swarm & Backtesting Integration (v3.10.0)

This document summarizes the state of the codebase following the completion of Phase 11: Multi-Agent Swarm Research & Backtesting Integration using the HKUDS Vibe-Trading architecture.

## Current Project State
The project now features a containerized Vibe-Trading Model Context Protocol (MCP) server, an interactive Research Lab panel on the dashboard with a context-aware chatbot, strategy exporters (Pine Script, MT5 code, and PDF/Markdown reports), and a 3-month daily-picks backtester visualization inside the Costs tab.

### What Was Built (Latest Pass)
1. **Containerized Vibe-Trading MCP Server (`docker-compose.yml`)**
   - Configured the new container service `vibe-trading-mcp` communicating over SSE transport protocol on port `8010`.
   - Developed `src/clients/vibe_mcp.py` (`VibeMcpClient`) to query and direct analyst swarms.
2. **Interactive Research Lab UI & API**
   - **Backend Route (`src/routes/chat.py`):** Implemented `/api/v1/chat` and `/api/v1/artifacts/export` endpoints.
   - **Frontend View (`static/index.html`):** Added a dedicated **Research Lab** menu tab containing Analyst Swarms selectors, Artifact Export downloads, and the Chatbot interface.
   - **JS Bindings (`static/app.js`):** Implemented `initResearchLab()` mapping actions for swarm choices, chat inputs, dialogue clearings, and download actions.
3. **Portfolio Strategy Backtesting**
   - **LangGraph Discovery Node (`src/dag/discovery_graph.py`):** Added `backtest_picks_node` running a 3-month simulation of picks via the MCP backtest tool, persisting results directly in DynamoDB.
   - **Visual Observability Panel:** Embedded a Discovery Picks Backtesting visual summary in the Costs tab, hydrated dynamically by `fetchDailyPicks()`.
4. **FinOps Limits Settings Toggle**
   - Introduced `enable_finops_limits` setting (defaults to `False`) to bypass budget gating checks in local dev or high-intensity research cycles.

---

## File Map & Coordinates
- **Vibe MCP Client**: [vibe_mcp.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/clients/vibe_mcp.py)
- **Chat & Exporters API**: [chat.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/routes/chat.py)
- **LangGraph Orchestrator**: [discovery_graph.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/dag/discovery_graph.py)
- **FinOps Gate Check**: [nodes.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/dag/nodes.py)
- **UI Presentation**: [index.html](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/static/index.html) and [app.js](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/static/app.js)
- **Release logs**: [CHANGELOG.md](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/CHANGELOG.md)
- **Development narrative**: [dev-blog/DEVELOPMENT_BLOG.md](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/dev-blog/DEVELOPMENT_BLOG.md)

---

## Technical Instructions for Next Agent
- **MCP Communications**: Ensure the `vibe-trading-mcp` service is running in Docker (`docker-compose ps`). It serves tools over SSE on `http://vibe-trading-mcp:8010`.
- **Environment Run**: Verify python code builds and runs using `./scripts/syntax_check.sh`.
- **LLM Environment Routing Rules**: 
  - **Local Runs**: 
    - **Main App**: Set `LLM_PROVIDER=ollama` and pull `llama3.2` locally.
    - **Vibe-Trading MCP**: Set `LANGCHAIN_PROVIDER=ollama`, `LANGCHAIN_MODEL_NAME=llama3.2`, and `OLLAMA_BASE_URL=http://host.docker.internal:11434`. *(Note: If the local model hallucinates placeholder templates instead of calling tools, switch the MCP to a cloud provider like OpenAI).*
    - **CRITICAL**: The docker containers require an active internet connection to download yfinance market data, headlines, and trigger backtests.
  - **Cloud Runs**: 
    - **Main App**: Set `LLM_PROVIDER=bedrock` to call Claude 3 Haiku over AWS Bedrock Converse API.
    - **Vibe-Trading MCP**: Since the MCP server's underlying package does not support Bedrock natively, configure it with an OpenAI-compatible cloud provider (e.g. OpenAI, Gemini, or DeepSeek) using `LANGCHAIN_PROVIDER`, `LANGCHAIN_MODEL_NAME`, and the corresponding API key (e.g. `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`).
- **Chatbot Swarm Tool Routing**: The `vibe-trading-mcp` server does not expose an `ask_question` tool. To handle chat queries, `/api/v1/chat` maps user queries to valid swarm presets (`investment_committee`, `quant_strategy_desk`, `macro_strategy_forum`, `risk_committee`) by executing a structured variable extraction parser using `call_llm`, invoking `run_swarm` with the arguments on success, and falling back to direct LLM completion for general queries.
