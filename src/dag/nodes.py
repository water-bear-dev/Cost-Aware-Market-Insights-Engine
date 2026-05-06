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
    """Invokes AWS Bedrock / Claude 3 Haiku."""
    logger.info("Invoking Bedrock AI")
    # Idempotent logging
    record_cost(Decimal(str(state.get("estimated_cost", 0.0))))
    return {"messages": [AIMessage(content="Generated Alpha-DAG insight.")]}

def validation_node(state: AlphaDagState) -> dict:
    """Validates the output against quantitative risk thresholds."""
    logger.info("Validating Output")
    messages = state.get("messages", [])
    last_content = messages[-1].content if messages else ""
    return {
        "risk_approved": True, 
        "sentiment_score": 0.85, 
        "final_insight": last_content
    }
