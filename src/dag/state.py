from typing import TypedDict, Annotated, Sequence, Optional
from langchain_core.messages import BaseMessage
import operator

class AlphaDagState(TypedDict):
    """
    State payload passed between LangGraph nodes.
    """
    # LangChain message history (appended to on each step)
    messages: Annotated[Sequence[BaseMessage], operator.add]
    
    # Core identifying data
    ticker: str
    
    # Payload from the Market Data MCP
    market_data: Optional[dict]
    
    # Results from the isolated Quant Compute MCP
    quant_analysis: Optional[dict]
    
    # FinOps Tracking
    estimated_cost: float
    finops_budget_cleared: bool
    
    # Validation gates
    sentiment_score: Optional[float]
    risk_approved: bool
    
    # Final generated payload
    final_insight: Optional[str]
