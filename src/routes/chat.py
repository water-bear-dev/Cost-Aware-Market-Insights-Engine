from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Tuple, Dict, Any
from src.synthesis.llm import call_llm
from src.clients.vibe_mcp import vibe_mcp_client
import structlog
import json
import io
import re

logger = structlog.get_logger(__name__)
router = APIRouter()

PRESET_MAP = {
    "investment": "investment_committee",
    "quant": "quant_strategy_desk",
    "crypto": "investment_committee",  # investment committee with market forced to crypto
    "macro": "macro_strategy_forum",
    "risk": "risk_committee",
}


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"


class ChatMessage(BaseModel):
    sender: str
    text: str


class ChatResponse(BaseModel):
    response: str
    session_id: str
    model_used: str
    messages: Optional[List[ChatMessage]] = None


def parse_team_prefix(query: str) -> Tuple[str, str]:
    """Extract optional [Team: ...] prefix. Returns (active_team, user_text)."""
    match = re.match(r"^\[Team:\s*([^\]]+)\]\s*(.*)$", query, re.IGNORECASE)
    if match:
        return match.group(1).lower().strip(), match.group(2).strip()
    return "investment", query


def preset_for_team(active_team: str) -> str:
    """Map UI team selector to vibe-trading swarm preset name."""
    return PRESET_MAP.get(active_team, "investment_committee")


def build_router_prompt(preset_name: str, user_text: str) -> str:
    """Build the LLM routing prompt for swarm variable extraction."""
    return (
        "You are an AI routing coordinator. Your job is to analyze a user's financial question and determine if it can be fulfilled by running a specialized multi-agent swarm research preset.\n\n"
        f"Active Team Preset: {preset_name}\n"
        f"User Message: {user_text}\n\n"
        "Here are the variables required for each preset:\n"
        "1. 'investment_committee':\n"
        "   - 'target': The stock ticker/security symbol (e.g. 'AAPL', 'BTC-USDT', 'NVDA'). Must be present to run this swarm.\n"
        "   - 'market': The market type (e.g. 'US', 'crypto', 'Hong Kong', 'A-shares').\n"
        "2. 'quant_strategy_desk':\n"
        "   - 'market': The target market (e.g. 'US', 'crypto', 'A-shares').\n"
        "   - 'goal': The quantitative research objective or trading idea.\n"
        "3. 'risk_committee':\n"
        "   - 'goal': The portfolio or asset risk assessment objective.\n"
        "4. 'macro_strategy_forum':\n"
        "   - 'market': The macro market focus ('global', 'US', 'A-shares', 'crypto').\n"
        "   - 'horizon': The macro timeframe ('monthly', 'quarterly', 'annual').\n\n"
        "Respond ONLY with a valid JSON object matching this structure:\n"
        "{\n"
        "  \"should_run_swarm\": true/false,\n"
        "  \"variables\": { ... } (map of extracted variables if should_run_swarm is true, otherwise empty),\n"
        "  \"reason\": \"short explanation of routing decision\"\n"
        "}\n"
        "Do not include any markdown fences, prefix, or trailing comments. Output raw JSON only."
    )


def _strip_markdown_fences(resp_text: str) -> str:
    text = resp_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _sanitize_variables(variables: Any) -> Dict[str, str]:
    if not isinstance(variables, dict):
        return {}
    sanitized: Dict[str, str] = {}
    for k, v in variables.items():
        if isinstance(v, list):
            sanitized[k] = ", ".join(str(item) for item in v)
        elif v is None:
            sanitized[k] = ""
        else:
            sanitized[k] = str(v)
    return sanitized


def parse_router_llm_text(resp_text: str) -> dict:
    """
    Parse router LLM output into {should_run_swarm, variables, reason}.
    Raises json.JSONDecodeError / ValueError on invalid content.
    """
    cleaned = _strip_markdown_fences(resp_text)
    parse_data = json.loads(cleaned)
    if not isinstance(parse_data, dict):
        raise ValueError("Router response is not a JSON object")
    return {
        "should_run_swarm": bool(parse_data.get("should_run_swarm", False)),
        "variables": _sanitize_variables(parse_data.get("variables", {})),
        "reason": parse_data.get("reason", ""),
    }


def validate_swarm_variables(preset_name: str, variables: Dict[str, str]) -> bool:
    """Return True if required variables for the preset are present and non-empty."""
    if preset_name == "investment_committee":
        target_val = variables.get("target")
        return bool(target_val and str(target_val).strip())
    if preset_name == "quant_strategy_desk":
        goal_val = variables.get("goal")
        return bool(goal_val and str(goal_val).strip())
    if preset_name == "risk_committee":
        goal_val = variables.get("goal")
        return bool(goal_val and str(goal_val).strip())
    if preset_name == "macro_strategy_forum":
        horizon_val = variables.get("horizon")
        return bool(horizon_val and str(horizon_val).strip())
    return True


def format_swarm_messages(payload: dict) -> Optional[Tuple[str, List[ChatMessage]]]:
    """
    Turn a swarm JSON payload into (unified_text, messages).
    Returns None if there is nothing usable to display.
    """
    if not isinstance(payload, dict):
        return None

    report = payload.get("final_report")
    tasks = payload.get("tasks", [])
    messages: List[ChatMessage] = []

    for task in tasks:
        agent_id = task.get("agent_id")
        status = task.get("status")
        summary = task.get("summary")
        error = task.get("error")

        if status == "completed" and summary:
            messages.append(ChatMessage(sender=agent_id, text=summary))
        elif status == "failed":
            messages.append(
                ChatMessage(
                    sender=agent_id,
                    text=f"⚠️ **Analysis failed**: {error or 'Unknown error'}",
                )
            )

    if report:
        messages.append(ChatMessage(sender="assistant", text=report))

    if not messages:
        return None

    unified_parts = []
    for m in messages:
        sender_title = m.sender.replace("_", " ").title()
        unified_parts.append(f"### 🤖 {sender_title}\n{m.text}")
    unified_text = "\n\n".join(unified_parts)
    return unified_text, messages


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: Request, body: ChatRequest):
    """Conversational market research chatbot using vibe-trading-mcp tools or fallback LLM."""
    query = body.message
    session_id = body.session_id or "default"
    logger.info("Chat query received", query=query, session_id=session_id)

    active_team, user_text = parse_team_prefix(query)
    preset_name = preset_for_team(active_team)

    should_run_swarm = False
    variables: Dict[str, str] = {}

    try:
        parse_res = call_llm(build_router_prompt(preset_name, user_text), max_tokens=300)
        parse_data = parse_router_llm_text(parse_res.get("text", ""))
        should_run_swarm = parse_data["should_run_swarm"]
        variables = parse_data["variables"]
        logger.info(
            "Parser router decision",
            should_run=should_run_swarm,
            variables=variables,
            reason=parse_data.get("reason"),
        )
    except Exception as e:
        logger.warn(
            "Failed to parse query for swarm variables, falling back to direct LLM execution",
            error=str(e),
        )
        should_run_swarm = False

    if should_run_swarm and not validate_swarm_variables(preset_name, variables):
        should_run_swarm = False
        logger.info("Bypassing run_swarm because required variables are empty", preset=preset_name)

    if should_run_swarm:
        if active_team == "crypto":
            preset_name = "investment_committee"
            if "market" not in variables or not variables["market"]:
                variables["market"] = "crypto"

        logger.info("Invoking run_swarm tool on vibe-trading-mcp", preset=preset_name, vars=variables)
        mcp_res = await vibe_mcp_client.call_tool(
            "run_swarm",
            {
                "preset_name": preset_name,
                "variables": variables,
                "wait_seconds": 60,
            },
        )

        # mock_fallback is fabricated offline content — never treat as a successful swarm report
        if mcp_res.get("status") == "mock_fallback":
            logger.warn(
                "MCP returned mock_fallback; falling through to direct LLM",
                tool="run_swarm",
            )
        elif mcp_res.get("status") == "success":
            try:
                payload = json.loads(mcp_res["content"])
                formatted = format_swarm_messages(payload) if isinstance(payload, dict) else None
                if formatted:
                    unified_text, messages = formatted
                    return ChatResponse(
                        response=unified_text,
                        messages=messages,
                        session_id=session_id,
                        model_used=f"vibe-swarm-{active_team}",
                    )
                logger.warn(
                    "Swarm payload missing final_report and tasks, falling back to direct LLM",
                    payload=payload if isinstance(payload, dict) else None,
                )
            except Exception as e:
                # Plain-text success content (non-JSON) is still a real MCP reply
                if mcp_res.get("content"):
                    fallback_text = mcp_res["content"]
                    return ChatResponse(
                        response=fallback_text,
                        messages=[ChatMessage(sender="assistant", text=fallback_text)],
                        session_id=session_id,
                        model_used="vibe-trading-mcp",
                    )
                logger.error("Failed to parse swarm tool response content", error=str(e))

    logger.info("Executing direct LLM for chat response")
    prompt = (
        f"You are the Vibe-Trading Swarm Intelligence Assistant, a world-class financial quantitative researcher.\n"
        f"Answer the user's trading, backtesting, or strategy question below.\n"
        f"Query: {user_text}\n\n"
        f"Provide a professional, concise, yet mathematically sound analysis. Do not include excessive warnings, but keep standard disclaimers concise."
    )

    try:
        res = call_llm(prompt)
        text = res["text"]
        return ChatResponse(
            response=text,
            messages=[ChatMessage(sender="assistant", text=text)],
            session_id=session_id,
            model_used=res["model_used"],
        )
    except Exception as e:
        logger.error("LLM chat response generation failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Chat generation failed: {str(e)}")


@router.get("/artifacts/export")
def export_artifact(
    ticker: str = Query(..., description="Ticker symbol (e.g. AAPL)"),
    type: str = Query("pinescript", description="Type of artifact: pinescript, mt5, report"),
):
    """Generates and exports strategy code or research report artifacts."""
    ticker = ticker.upper().strip()
    type_lower = type.lower().strip()

    logger.info("Exporting trading artifact", ticker=ticker, type=type_lower)

    if type_lower == "pinescript":
        prompt = (
            f"Write a high-quality, valid TradingView Pine Script v5 strategy for trading {ticker}.\n"
            f"Use standard indicators (like EMA crossover or RSI thresholds) suitable for {ticker}.\n"
            f"Output ONLY the raw Pine Script code. No explanations, no markdown blocks, no prefix or suffix."
        )
        filename = f"{ticker}_strategy.pine"
        media_type = "text/plain"
    elif type_lower == "mt5":
        prompt = (
            f"Write a complete, syntactically correct MQL5 expert advisor code for MetaTrader 5 to trade {ticker}.\n"
            f"Use simple moving averages or simple RSI rules.\n"
            f"Output ONLY the raw MQL5 code. No explanations, no markdown blocks, no prefix or suffix."
        )
        filename = f"{ticker}_ea.mq5"
        media_type = "text/plain"
    elif type_lower == "report":
        prompt = (
            f"Generate a comprehensive investment research report for {ticker}.\n"
            f"Include sections: Executive Summary, Key Drivers, Risk Factors, and Technical Analysis.\n"
            f"Write in plain Markdown."
        )
        filename = f"{ticker}_research_report.md"
        media_type = "text/markdown"
    else:
        raise HTTPException(status_code=400, detail="Invalid artifact type. Choose from: pinescript, mt5, report")

    try:
        res = call_llm(prompt, max_tokens=1500)
        code_content = res["text"]

        if code_content.startswith("```"):
            lines = code_content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            code_content = "\n".join(lines)

        file_like = io.BytesIO(code_content.encode("utf-8"))
        return StreamingResponse(
            file_like,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error("Artifact generation failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
