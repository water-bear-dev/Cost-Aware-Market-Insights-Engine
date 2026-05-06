from mcp.server.fastmcp import FastMCP
import pandas as pd
import numpy as np

# Create the MCP Server
mcp = FastMCP("Quant Compute")

@mcp.tool()
def calculate_metrics(prices: list[float]) -> dict:
    """Calculates quantitative risk and momentum metrics from a list of historical prices.
    
    Args:
        prices: A list of historical closing prices ordered from oldest to newest.
    """
    if not prices or len(prices) < 2:
        return {"error": "Not enough data"}
        
    s = pd.Series(prices)
    returns = s.pct_change().dropna()
    
    volatility = returns.std() * np.sqrt(252) # Annualized volatility
    momentum = (prices[-1] / prices[0]) - 1.0
    
    return {
        "volatility_annualized": float(volatility) if not pd.isna(volatility) else 0.0,
        "momentum": float(momentum),
        "mean_return": float(returns.mean()) if not pd.isna(returns.mean()) else 0.0,
        "max_drawdown": float(((s / s.cummax()) - 1).min())
    }

if __name__ == "__main__":
    # Run using stdio transport
    mcp.run()
