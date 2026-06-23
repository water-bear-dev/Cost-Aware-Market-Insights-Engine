from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from src.synthesis.llm import call_llm
from src.clients.vibe_mcp import vibe_mcp_client
import structlog
import json
import io

logger = structlog.get_logger(__name__)
router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"

class ChatResponse(BaseModel):
    response: str
    session_id: str
    model_used: str

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: Request, body: ChatRequest):
    """Conversational market research chatbot using vibe-trading-mcp tools or fallback LLM."""
    query = body.message
    session_id = body.session_id or "default"
    logger.info("Chat query received", query=query, session_id=session_id)
    
    # 1. Attempt to delegate to vibe-trading-mcp research agent
    mcp_res = await vibe_mcp_client.call_tool("ask_question", {"query": query, "session_id": session_id})
    
    if mcp_res.get("status") == "success":
        return ChatResponse(
            response=mcp_res["content"],
            session_id=session_id,
            model_used="vibe-trading-mcp"
        )
        
    # 2. Fallback to local LLM with market research context
    logger.info("Falling back to local LLM for chat response")
    prompt = (
        f"You are the Vibe-Trading Swarm Intelligence Assistant, a world-class financial quantitative researcher.\n"
        f"Answer the user's trading, backtesting, or strategy question below.\n"
        f"Query: {query}\n\n"
        f"Provide a professional, concise, yet mathematically sound analysis. Do not include excessive warnings, but keep standard disclaimers concise."
    )
    
    try:
        res = call_llm(prompt)
        return ChatResponse(
            response=res["text"],
            session_id=session_id,
            model_used=res["model_used"]
        )
    except Exception as e:
        logger.error("LLM fallback chat failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Chat generation failed: {str(e)}")

@router.get("/artifacts/export")
def export_artifact(
    ticker: str = Query(..., description="Ticker symbol (e.g. AAPL)"),
    type: str = Query("pinescript", description="Type of artifact: pinescript, mt5, report")
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
        
        # Clean any accidental LLM code block backticks
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
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error("Artifact generation failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
