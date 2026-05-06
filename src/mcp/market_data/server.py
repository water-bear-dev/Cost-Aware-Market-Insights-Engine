from mcp.server.fastmcp import FastMCP
import yfinance as yf
import httpx
import xml.etree.ElementTree as ET
import structlog

logger = structlog.get_logger(__name__)

# Create the MCP Server
mcp = FastMCP("Market Data")

@mcp.tool()
def fetch_headlines(ticker: str, max_count: int = 5) -> list[dict]:
    """Fetches up to max_count headlines with URLs from Google News RSS or Yahoo Finance.
    
    Args:
        ticker: The stock ticker symbol (e.g., AAPL).
        max_count: Maximum number of headlines to return.
    """
    results = []
    try:
        url = f"https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en"
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        
        root = ET.fromstring(response.text)
        items = root.findall('.//item')
        
        for item in items[:max_count]:
            title_el = item.find('title')
            link_el = item.find('link')
            source_el = item.find('source')
            pubdate_el = item.find('pubDate')
            
            title = title_el.text if title_el is not None else ''
            if title:
                results.append({
                    'title': title,
                    'url': link_el.text if link_el is not None else '',
                    'source': source_el.text if source_el is not None else '',
                    'published': pubdate_el.text if pubdate_el is not None else ''
                })
    except Exception as e:
        logger.error("Failed to fetch Google News RSS", ticker=ticker, error=str(e))
    
    # Fallback to yfinance news
    if not results:
        try:
            t = yf.Ticker(ticker)
            news = t.news or []
            for n in news[:max_count]:
                results.append({
                    'title': n.get('title', ''),
                    'url': n.get('link', ''),
                    'source': n.get('publisher', ''),
                    'published': ''
                })
        except Exception:
            pass
            
    return results

@mcp.tool()
def fetch_ticker_data(ticker_symbol: str) -> dict:
    """Fetches historical OHLCV data, current price, and headlines for a ticker.
    
    Args:
        ticker_symbol: The stock ticker symbol (e.g., AAPL).
    """
    try:
        ticker = yf.Ticker(ticker_symbol)
        hist = ticker.history(period="5d")
        
        if not hist.empty:
            latest = hist.iloc[-1]
            open_price = float(latest['Open'])
            close_price = float(latest['Close'])
            high_price = float(latest['High'])
            low_price = float(latest['Low'])
            volume = int(latest['Volume'])
            change_pct = ((close_price - open_price) / open_price) * 100 if open_price else 0.0
        else:
            info = getattr(ticker, 'fast_info', {})
            close_price = info.get('lastPrice') or info.get('last_price')
            if not close_price:
                raw_info = ticker.info
                close_price = raw_info.get('regularMarketPrice') or raw_info.get('currentPrice')
            if not close_price:
                return {}
            close_price = float(close_price)
            open_price = high_price = low_price = close_price
            volume = 0
            change_pct = 0.0
            
        headlines_data = fetch_headlines(ticker_symbol, max_count=5)
        
        return {
            'ticker': ticker_symbol,
            'open_price': open_price,
            'high_price': high_price,
            'low_price': low_price,
            'close_price': close_price,
            'volume': volume,
            'change_pct': change_pct,
            'headlines': [h['title'] for h in headlines_data],
            'headline_links': headlines_data
        }
    except Exception as e:
        logger.error("Error fetching ticker data", ticker=ticker_symbol, error=str(e))
        return {}

if __name__ == "__main__":
    # Run using stdio transport
    mcp.run()
