import yfinance as yf
from datetime import datetime
import hashlib
import structlog
from decimal import Decimal
import json
import httpx
import xml.etree.ElementTree as ET

from src.config import settings
from src.clients.dynamo import get_table

logger = structlog.get_logger(__name__)

def fetch_top_headline(ticker: str) -> str:
    """Fetches the top aggregated headline for a ticker from Google News RSS."""
    try:
        url = f"https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en"
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        
        root = ET.fromstring(response.text)
        item = root.find('.//item/title')
        if item is not None and item.text:
            return item.text
        return None
    except Exception as e:
        logger.error("Failed to fetch Google News RSS", ticker=ticker, error=str(e))
        return None

def fetch_ticker_data(ticker_symbol: str) -> dict:
    try:
        ticker = yf.Ticker(ticker_symbol)
        hist = ticker.history(period="1d")
        
        if hist.empty:
            logger.warning("No data found for ticker", ticker=ticker_symbol)
            return None
            
        latest = hist.iloc[-1]
        
        # News is an attribute of the Ticker object
        try:
            top_headline = fetch_top_headline(ticker_symbol)
            if top_headline:
                headlines = [top_headline]
            else:
                news = ticker.news
                headlines = [n.get('title', '') for n in news[:1]] if news else []
        except Exception:
            headlines = []
            
        open_price = float(latest['Open'])
        close_price = float(latest['Close'])
        change_pct = ((close_price - open_price) / open_price) * 100 if open_price else 0.0
        
        return {
            'ticker': ticker_symbol,
            'open_price': open_price,
            'high_price': float(latest['High']),
            'low_price': float(latest['Low']),
            'close_price': close_price,
            'volume': int(latest['Volume']),
            'change_pct': change_pct,
            'headlines': headlines
        }
    except Exception as e:
        logger.error("Error fetching ticker data", ticker=ticker_symbol, error=str(e))
        return None

def get_active_tickers() -> list[str]:
    """Fetch active tickers from the DynamoDB Tickers table."""
    table = get_table('Tickers')
    try:
        response = table.scan()
        items = response.get('Items', [])
        
        # If empty, seed from config
        if not items:
            for t in settings.ticker_list:
                table.put_item(Item={'ticker': t})
            return settings.ticker_list
            
        return [item['ticker'] for item in items]
    except Exception as e:
        logger.error("Failed to fetch active tickers", error=str(e))
        return settings.ticker_list

def force_ingest_single_ticker(ticker: str) -> bool:
    """Ingests data for a single ticker outside of the normal schedule."""
    logger.info("Forcing ingestion for single ticker", ticker=ticker)
    
    table = get_table('MarketData')
    timestamp = datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60)
    
    data = fetch_ticker_data(ticker)
    if not data:
        return False
        
    data_string = f"{data['ticker']}{data['close_price']}{''.join(data['headlines'])}"
    data_hash = hashlib.md5(data_string.encode()).hexdigest()
    
    item = {
        'ticker': data['ticker'],
        'timestamp': timestamp,
        'open_price': Decimal(str(data['open_price'])),
        'high_price': Decimal(str(data['high_price'])),
        'low_price': Decimal(str(data['low_price'])),
        'close_price': Decimal(str(data['close_price'])),
        'volume': data['volume'],
        'change_pct': Decimal(str(data['change_pct'])),
        'headlines': data['headlines'],
        'data_hash': data_hash,
        'ttl': ttl
    }
    
    try:
        table.put_item(Item=item)
        
        # Once inserted, synthesize immediately
        from src.synthesis.service import synthesize_findings
        synthesize_findings(item)
        return True
    except Exception as e:
        logger.error("Failed to force ingest ticker", ticker=ticker, error=str(e))
        return False

def ingest_market_data():
    """Runs on a schedule to fetch and store market data."""
    logger.info("Starting market data ingestion")
    table = get_table('MarketData')
    
    timestamp = datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60) # 30 days
    
    tickers = get_active_tickers()
    success_count = 0
    for t in tickers:
        data = fetch_ticker_data(t)
        if not data:
            continue
            
        data_string = f"{data['ticker']}{data['close_price']}{''.join(data['headlines'])}"
        data_hash = hashlib.md5(data_string.encode()).hexdigest()
        
        # DynamoDB uses Decimal for floats
        item = {
            'ticker': data['ticker'],
            'timestamp': timestamp,
            'open_price': Decimal(str(data['open_price'])),
            'high_price': Decimal(str(data['high_price'])),
            'low_price': Decimal(str(data['low_price'])),
            'close_price': Decimal(str(data['close_price'])),
            'volume': data['volume'],
            'change_pct': Decimal(str(data['change_pct'])),
            'headlines': data['headlines'],
            'data_hash': data_hash,
            'ttl': ttl
        }
        
        try:
            table.put_item(Item=item)
            success_count += 1
            logger.info("Ingested data for ticker", ticker=t)
        except Exception as e:
            logger.error("Failed to write to DynamoDB", ticker=t, error=str(e))
            
    logger.info("Ingestion complete", success_count=success_count, total=len(tickers))
    return success_count
