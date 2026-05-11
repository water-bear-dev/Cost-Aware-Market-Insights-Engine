from mcp.server.fastmcp import FastMCP
import yfinance as yf
import httpx
import xml.etree.ElementTree as ET
import structlog
import os
import json
import boto3

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

@mcp.tool()
def fetch_financial_statements(tickers: list[str]) -> str:
    """Fetches fundamental financial statements and saves them to the Bronze data lake.
    
    Args:
        tickers: List of stock ticker symbols (e.g., ['AAPL', 'MSFT']).
    """
    bucket = os.getenv("S3_DATALAKE_BUCKET")
    s3_client = boto3.client('s3') if bucket else None
    
    local_dir = "scratch/bronze/financials"
    if not bucket:
        os.makedirs(local_dir, exist_ok=True)
        
    results = []
    
    for ticker_symbol in tickers:
        try:
            ticker = yf.Ticker(ticker_symbol)
            
            def extract_latest(df):
                if df is None or df.empty:
                    return {}
                # The columns are usually timestamps (dates of the statements)
                # We sort them descending and pick the first column (latest date)
                latest_date = sorted(df.columns, reverse=True)[0]
                latest_data = df[latest_date].fillna(0).to_dict()
                return latest_data, str(latest_date)
            
            latest_income, inc_date = extract_latest(ticker.income_stmt)
            latest_bs, bs_date = extract_latest(ticker.balance_sheet)
            latest_cf, cf_date = extract_latest(ticker.cashflow)
            
            data = {
                "ticker": ticker_symbol,
                "report_date": inc_date, # Approximation, assume they align
                "net_income": latest_income.get("Net Income", 0),
                "total_revenue": latest_income.get("Total Revenue", 0),
                "total_assets": latest_bs.get("Total Assets", 0),
                "total_equity": latest_bs.get("Stockholders Equity", 0) or latest_bs.get("Total Equity Gross Minority Interest", 0),
                "total_debt": latest_bs.get("Total Debt", 0),
                "operating_cash_flow": latest_cf.get("Operating Cash Flow", 0)
            }
            
            json_data = json.dumps(data)
            
            if bucket:
                s3_key = f"bronze/financials/{ticker_symbol}.json"
                s3_client.put_object(Bucket=bucket, Key=s3_key, Body=json_data)
                results.append(f"Saved {ticker_symbol} to S3 {bucket}/{s3_key}")
            else:
                file_path = os.path.join(local_dir, f"{ticker_symbol}.json")
                with open(file_path, "w") as f:
                    f.write(json_data)
                results.append(f"Saved {ticker_symbol} to {file_path}")
                
        except Exception as e:
            logger.error(f"Failed to fetch financials for {ticker_symbol}", error=str(e))
            results.append(f"Failed {ticker_symbol}: {str(e)}")
            
    return "\n".join(results)

if __name__ == "__main__":
    # Run using stdio transport
    mcp.run()
