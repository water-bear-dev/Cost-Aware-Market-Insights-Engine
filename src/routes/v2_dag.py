from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import structlog
from src.dag.graph import alpha_dag

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["V2 Alpha-DAG"])

class DagSynthesisResponse(BaseModel):
    ticker: str
    status: str
    finops_approved: bool
    insight: Optional[str]
    cost: float
    sentiment_score: Optional[float] = None
    sentiment_label: Optional[str] = None
    social_volume: Optional[int] = None
    sentiment_sources: Optional[dict] = None
    sentiment_divergence: Optional[bool] = None
    sentiment_confidence: Optional[float] = None
    sentiment_errors: Optional[list] = None

@router.post("/{ticker}/synthesize", response_model=DagSynthesisResponse)
async def trigger_dag_synthesis(ticker: str):
    """Triggers the LangGraph Alpha-DAG for a specific ticker."""
    logger.info("Triggering V2 DAG Synthesis", ticker=ticker)
    
    # Initialize LangGraph state
    initial_state = {
        "ticker": ticker.upper(),
        "messages": [],
        "estimated_cost": 0.0,
        "finops_budget_cleared": False,
        "market_data": None,
        "quant_analysis": None,
        "sentiment_score": None,
        "sentiment_label": None,
        "social_volume": 0,
        "sentiment_sources": {},
        "sentiment_divergence": False,
        "sentiment_confidence": 0.0,
        "sentiment_errors": [],
        "risk_approved": False,
        "final_insight": None
    }
    
    try:
        # Invoke the graph asynchronously
        final_state = await alpha_dag.ainvoke(initial_state)
        
        return DagSynthesisResponse(
            ticker=ticker,
            status="success",
            finops_approved=final_state.get("finops_budget_cleared", False),
            insight=final_state.get("final_insight"),
            cost=final_state.get("estimated_cost", 0.0),
            sentiment_score=final_state.get("sentiment_score"),
            sentiment_label=final_state.get("sentiment_label"),
            social_volume=final_state.get("social_volume"),
            sentiment_sources=final_state.get("sentiment_sources"),
            sentiment_divergence=final_state.get("sentiment_divergence"),
            sentiment_confidence=final_state.get("sentiment_confidence"),
            sentiment_errors=final_state.get("sentiment_errors"),
        )
    except Exception as e:
        logger.error("DAG Execution Failed", ticker=ticker, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"DAG execution failed: {str(e)}")
