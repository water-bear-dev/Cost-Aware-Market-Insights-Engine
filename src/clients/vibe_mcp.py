import asyncio
import structlog
from mcp import ClientSession
from mcp.client.sse import sse_client
from src.config import settings

logger = structlog.get_logger(__name__)

class VibeMcpClient:
    def __init__(self):
        self.url = settings.vibe_trading_mcp_url

    async def call_tool(self, tool_name: str, arguments: dict = None) -> dict:
        """Call an MCP tool on the vibe-trading-mcp server."""
        if arguments is None:
            arguments = {}
        logger.info("Calling vibe-trading-mcp tool", tool=tool_name, args=arguments)
        try:
            async with sse_client(self.url) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments)
                    # Extract content text from response
                    text_content = ""
                    if res and hasattr(res, "content"):
                        for item in res.content:
                            if hasattr(item, "text"):
                                text_content += item.text
                    logger.info("Mcp tool call response received", tool=tool_name)
                    return {"status": "success", "content": text_content}
        except Exception as e:
            logger.error("Failed to connect or invoke tool on vibe-trading-mcp", tool=tool_name, error=str(e))
            # Fallback mock behaviors for robust offline/test runs
            return self._mock_fallback(tool_name, arguments, str(e))

    async def list_tools(self) -> list:
        """List available tools on the vibe-trading-mcp server."""
        try:
            async with sse_client(self.url) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    res = await session.list_tools()
                    tools_list = []
                    if res and hasattr(res, "tools"):
                        for t in res.tools:
                            tools_list.append({
                                "name": t.name,
                                "description": t.description or "",
                                "inputSchema": t.inputSchema
                            })
                    return tools_list
        except Exception as e:
            logger.warn("Failed to retrieve tools list from vibe-trading-mcp", error=str(e))
            return []

    def _mock_fallback(self, tool_name: str, arguments: dict, error_msg: str) -> dict:
        """Fallback mock values in case container is unreachable."""
        logger.info("Using mock fallback for tool", tool=tool_name)
        if "backtest" in tool_name.lower():
            return {
                "status": "mock_fallback",
                "content": '{"sharpe_ratio": 1.85, "max_drawdown": -0.065, "cumulative_return": 0.124, "annualized_volatility": 0.14, "beta": 0.95}'
            }
        elif "swarm" in tool_name.lower() or "analyst" in tool_name.lower():
            return {
                "status": "mock_fallback",
                "content": "Investment Swarm Consensus: Bullish. Macro indicators stable, Risk signals low volatility, Catalyst team points to upcoming earnings beat."
            }
        else:
            return {
                "status": "mock_fallback",
                "content": f"Mock reply: The MCP server is currently starting or unreachable ({error_msg}). Here is a simulated response for query: {arguments.get('query', 'N/A')}."
            }

vibe_mcp_client = VibeMcpClient()


def run_sync(coro):
    """Run an async coroutine synchronously, handling existing loops."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
        
    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


class VibeMcpClientSync:
    """Sync wrapper around VibeMcpClient."""
    def __init__(self, client: VibeMcpClient):
        self.client = client

    def call_tool(self, tool_name: str, arguments: dict = None) -> dict:
        return run_sync(self.client.call_tool(tool_name, arguments))

    def list_tools(self) -> list:
        return run_sync(self.client.list_tools())

vibe_mcp_client_sync = VibeMcpClientSync(vibe_mcp_client)

