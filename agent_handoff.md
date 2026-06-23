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
- **Bedrock / Ollama fallback**: Both `/api/v1/chat` and backtesting fall back cleanly to local/Bedrock LLM models if the premium models are constrained.
