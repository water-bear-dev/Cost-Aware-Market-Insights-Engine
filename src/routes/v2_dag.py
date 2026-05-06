from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import structlog
from src.dag.graph import alpha_dag

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["V2 Alpha-DAG"])

class DagSynthesisResponse(BaseModel):
    ticker: str
    status: str
    finops_approved: bool
    insight: str | None
    cost: float

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
            cost=final_state.get("estimated_cost", 0.0)
        )
    except Exception as e:
        logger.error("DAG Execution Failed", ticker=ticker, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"DAG execution failed: {str(e)}")
