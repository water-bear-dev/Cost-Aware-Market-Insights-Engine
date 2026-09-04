# Agent Handoff: HKUDS Vibe-Trading Swarm & Backtesting Integration (v3.10.2)

This document summarizes the state of the codebase following Phase 11 (Vibe-Trading) plus the chatbot factual-correctness test harness.

## Current Project State
The project features a containerized Vibe-Trading MCP server, Research Lab chatbot with swarm routing, strategy exporters, discovery backtesting in the Costs tab, and a pytest suite that locks down chat routing offline with an optional live groundedness eval.

### What Was Built (Latest Pass)
1. **Chat testability refactor (`src/routes/chat.py`)**
   - Extracted helpers: `parse_team_prefix`, `preset_for_team`, `build_router_prompt`, `parse_router_llm_text`, `validate_swarm_variables`, `format_swarm_messages`.
   - **Hardening:** MCP `status=mock_fallback` is treated as a swarm failure and falls through to direct LLM (never returned as a successful swarm consensus).
2. **Offline + optional live tests**
   - `tests/test_chat_router.py` — table-driven routing/validation from `tests/fixtures/chat_router_cases.json`.
   - `tests/test_chat_endpoint.py` — path integrity with mocked `call_llm` / `vibe_mcp_client`.
   - `tests/chat_assertions.py` — anti-placeholder / anti-mock / ticker presence helpers.
   - `tests/eval/test_chat_groundedness.py` — skipped unless `RUN_CHAT_EVAL=1`.
3. **Prior Phase 11 surface** (unchanged): vibe-trading-mcp on `:8010`, Research Lab UI, artifact export, discovery backtest node, `enable_finops_limits`.

---

## File Map & Coordinates
- **Vibe MCP Client**: [vibe_mcp.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/clients/vibe_mcp.py)
- **Chat & Exporters API**: [chat.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/routes/chat.py)
- **Chat tests**: [tests/](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/tests)
- **LangGraph Orchestrator**: [discovery_graph.py](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/src/dag/discovery_graph.py)
- **UI Presentation**: [index.html](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/static/index.html) and [app.js](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/static/app.js)
- **Release logs**: [CHANGELOG.md](file:///Users/andrewpham/Documents/GitHub/Cost-Aware-Market-Insights-Engine/CHANGELOG.md)

---

## Technical Instructions for Next Agent
- **MCP Communications**: Ensure the `vibe-trading-mcp` service is running in Docker (`docker-compose ps`). It serves tools over SSE on `http://vibe-trading-mcp:8010`.
- **Environment Run**: Verify python code builds and runs using `./scripts/syntax_check.sh`.
- **Chat tests**:
  ```bash
  pip install -r requirements-dev.txt
  pytest
  RUN_CHAT_EVAL=1 pytest tests/eval -m integration
  ```
  Offline tests use a minimal FastAPI app with only the chat router (no DynamoDB lifespan). Live eval needs a real LLM + reachable MCP for `expect_swarm` cases.
- **Known risk (v1)**: Cross-entity router mistakes (wrong ticker extracted) are not auto-corrected; contract tests only assert MCP args match router output.
- **LLM Environment Routing Rules**:
  - **Local Runs**:
    - **Main App**: Set `LLM_PROVIDER=ollama` and pull `llama3.2` locally.
    - **Vibe-Trading MCP**: Set `LANGCHAIN_PROVIDER=ollama`, `LANGCHAIN_MODEL_NAME=llama3.2`, and `OLLAMA_BASE_URL=http://host.docker.internal:11434`. *(If the local model hallucinates placeholder templates instead of calling tools, switch the MCP to a cloud provider like OpenAI.)*
    - **CRITICAL**: Docker containers need internet for yfinance / headlines / backtests.
  - **Cloud Runs**:
    - **Main App**: `LLM_PROVIDER=bedrock` for Claude 3 Haiku via Bedrock Converse.
    - **Vibe-Trading MCP**: Use an OpenAI-compatible provider (`LANGCHAIN_PROVIDER`, `LANGCHAIN_MODEL_NAME`, API key) — Bedrock is not supported natively by the MCP package.
- **Chatbot Swarm Tool Routing**: There is no `ask_question` tool. `/api/v1/chat` parses queries via `call_llm`, validates required vars, invokes `run_swarm` on success, and falls back to direct LLM for general queries, empty vars, parse failures, or `mock_fallback`.
