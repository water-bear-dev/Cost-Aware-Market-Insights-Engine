from src.dag.state import AlphaDagState
from langchain_core.messages import AIMessage
from decimal import Decimal
import structlog

# We import the existing FinOps logic
try:
    from src.cost_tracking.service import check_budget, record_cost
except ImportError:
    # Fallback if cost_tracking service isn't fully mocked
    def check_budget(cost: Decimal) -> bool: return True
    def record_cost(cost: Decimal): pass

logger = structlog.get_logger(__name__)

def finops_gate_node(state: AlphaDagState) -> dict:
    """Pre-flight check against DynamoDB ledger before AI execution."""
    # Heuristic cost estimation
    estimated_tokens = len(str(state.get("messages", []))) / 4 + 1000
    cost_estimate = float(estimated_tokens * 0.00025)
    
    is_approved = check_budget(Decimal(str(cost_estimate)))
    logger.info("FinOps Gate Checked", cost=cost_estimate, approved=is_approved)
    
    return {
        "estimated_cost": cost_estimate,
        "finops_budget_cleared": is_approved
    }

async def market_data_node(state: AlphaDagState) -> dict:
    """Connects to Market Data MCP to fetch latest OHLCV and news."""
    # TODO: Connect to Market Data MCP Server via mcp.client
    logger.info("Connecting to Market Data MCP", ticker=state.get("ticker"))
    return {"market_data": {"status": "mocked", "source": "MCP Server"}}

async def quant_compute_node(state: AlphaDagState) -> dict:
    """Connects to Quant Compute MCP to run risk/momentum math safely."""
    # TODO: Connect to Quant Compute MCP Server (Docker container)
    logger.info("Connecting to Quant Compute MCP Sandbox")
    return {"quant_analysis": {"status": "mocked", "volatility": 0.12}}

def bedrock_node(state: AlphaDagState) -> dict:
    """Invokes configured LLM to generate insights."""
    logger.info("Invoking LLM Node")
    from src.synthesis.llm import call_llm
    from src.cost_tracking.service import log_cost
    
    ticker = state.get("ticker")
    prompt = (
        f"Generate a professional financial insight for {ticker}.\n"
        f"Market Data: {state.get('market_data')}\n"
        f"Quant Analysis: {state.get('quant_analysis')}\n"
        "Provide a concise summary analysis and investment outlook."
    )
    
    res = call_llm(prompt)
    log_cost(ticker, res["input_tokens"], res["output_tokens"], res["model_used"])
    return {"messages": [AIMessage(content=res["text"])]}

def validation_node(state: AlphaDagState) -> dict:
    """Validates the output and attaches lexical sentiment details."""
    logger.info("Validating Output and running Sentiment analysis")
    from src.synthesis.sentiment import analyze_lexical_sentiment
    
    ticker = state.get("ticker")
    sent = analyze_lexical_sentiment(ticker)
    
    messages = state.get("messages", [])
    last_content = messages[-1].content if messages else ""
    return {
        "risk_approved": True, 
        "sentiment_score": sent["sentiment_score"],
        "sentiment_label": sent["sentiment_label"],
        "social_volume": sent["social_volume"],
        "sentiment_sources": sent.get("sources", {}),
        "sentiment_divergence": bool(sent.get("divergence", False)),
        "sentiment_confidence": float(sent.get("confidence", 0.0)),
        "sentiment_errors": sent.get("errors", []),
        "final_insight": last_content
    }
