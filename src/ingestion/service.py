import yfinance as yf
from datetime import datetime
import hashlib
import structlog
from decimal import Decimal
import json
import httpx
import xml.etree.ElementTree as ET

"""
Real-time Market Data Ingestion Service.

This module manages high-frequency data retrieval for active portfolio tracking.
It is optimized for low-latency updates and enforces a decoupled architecture 
to separate active watchlist assets from the broader analytical universe.
"""

from src.config import settings
from src.clients.dynamo import get_table

logger = structlog.get_logger(__name__)

def fetch_headlines(ticker: str, max_count: int = 5) -> list[dict]:
    """
    Fetches the latest news headlines for a specific ticker.

    Aggregates news from Google News RSS with a fallback to Yahoo Finance News.
    Ensures that investment theses are grounded in real-time market catalysts.

    Args:
        ticker (str): The ticker symbol.
        max_count (int): Maximum number of headlines to retrieve.

    Returns:
        list[dict]: A list of headline objects containing titles, URLs, and source info.
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
            link = link_el.text if link_el is not None else ''
            source = source_el.text if source_el is not None else ''
            pubdate = pubdate_el.text if pubdate_el is not None else ''
            
            if title:
                results.append({
                    'title': title,
                    'url': link,
                    'source': source,
                    'published': pubdate
                })
        # Explicitly sort by publication date (newest first)
        from email.utils import parsedate_to_datetime
        def parse_date(art):
            try:
                # Standard RSS date format
                return parsedate_to_datetime(art["published"])
            except:
                return datetime.min
        
        results.sort(key=parse_date, reverse=True)

    except Exception as e:
        logger.error("Failed to fetch Google News RSS", ticker=ticker, error=str(e))
    
    # Fallback to yfinance news if Google News returned nothing
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


import pytz
from datetime import datetime, time as dt_time

def is_market_open(ticker_symbol: str, exchange: str = "") -> 'typing.Union[bool, str]':
    """
    Check if a market is currently open based on ticker suffix or exchange name.
    Accounts for major global exchanges and their specific timezones/hours.
    """
    now_utc = datetime.now(pytz.utc)
    
    # 1. Map Ticker Suffix/Exchange to Timezone & Hours
    # Default: US Markets (NYSE/NASDAQ)
    tz_name = "US/Eastern"
    open_time = dt_time(9, 30)
    close_time = dt_time(16, 0)
    lunch_break = None # (start, end)
    
    t = ticker_symbol.upper()
    e = (exchange or "").upper()
    
    # Precise Exchange Matching
    if t.endswith(".AX") or any(x in e for x in ["ASX", "AUSTRALIA"]):
        tz_name = "Australia/Sydney"
        open_time = dt_time(10, 0)
        close_time = dt_time(16, 0)
    elif t.endswith(".L") or any(x in e for x in ["LSE", "LONDON", "FTSE"]):
        tz_name = "Europe/London"
        open_time = dt_time(8, 0)
        close_time = dt_time(16, 30)
    elif t.endswith(".T") or any(x in e for x in ["TSE", "TOKYO", "TYO"]):
        tz_name = "Asia/Tokyo"
        open_time = dt_time(9, 0)
        close_time = dt_time(15, 30)
        lunch_break = (dt_time(11, 30), dt_time(12, 30))
    elif t.endswith(".HK") or any(x in e for x in ["HKEX", "HONG KONG", "HKG"]):
        tz_name = "Asia/Hong_Kong"
        open_time = dt_time(9, 30)
        close_time = dt_time(16, 0)
        lunch_break = (dt_time(12, 0), dt_time(13, 0))
    elif t.endswith(".PA") or t.endswith(".AS") or t.endswith(".BR") or any(x in e for x in ["EURONEXT", "PARIS", "AMSTERDAM"]):
        tz_name = "Europe/Paris"
        open_time = dt_time(9, 0)
        close_time = dt_time(17, 30)
    elif t.endswith(".DE") or any(x in e for x in ["XETRA", "GERMANY", "DAX", "BERLIN"]):
        tz_name = "Europe/Berlin"
        open_time = dt_time(9, 0)
        close_time = dt_time(17, 30)
    
    # 2. Convert to Local Time
    local_tz = pytz.timezone(tz_name)
    local_now = now_utc.astimezone(local_tz)
    
    # 3. Weekend Check
    if local_now.weekday() >= 5: # Saturday=5, Sunday=6
        return False
        
    # 4. Hours Check
    current_time = local_now.time()
    if current_time < open_time or current_time > close_time:
        return False
        
    # 5. Lunch Break Check
    if lunch_break:
        start, end = lunch_break
        if current_time >= start and current_time < end:
            return "Lunch"
            
    return True

def fetch_ticker_data(ticker_symbol: str) -> dict:
    try:
        ticker = yf.Ticker(ticker_symbol)
        hist = ticker.history(period="5d")
        
        try:
            info = ticker.info
            exchange = info.get('exchange', '')
            company_name = info.get('longName') or info.get('shortName', '')
        except Exception:
            exchange = ''
            company_name = ''
            
        latest = None
        last_trading_day = None
        if not hist.empty:
            latest = hist.iloc[-1]
            last_trading_day = hist.index[-1].strftime('%Y-%m-%d')
            open_price = float(latest['Open'])
            close_price = float(latest['Close'])
            high_price = float(latest['High'])
            low_price = float(latest['Low'])
            volume = int(latest['Volume'])
            
            # Standard Market Change (Today Close vs Yesterday Close)
            try:
                prev_close = getattr(ticker.fast_info, 'previous_close', 0)
                if prev_close == 0 and len(hist) > 1:
                    prev_close = float(hist.iloc[-2]['Close'])
                
                if prev_close != 0:
                    change_pct = ((close_price - prev_close) / prev_close) * 100
                else:
                    # Fallback to intraday if previous close unavailable
                    change_pct = ((close_price - open_price) / open_price) * 100 if open_price else 0.0
            except:
                change_pct = ((close_price - open_price) / open_price) * 100 if open_price else 0.0
        else:
            # Fallback to ticker.info or fast_info if history fails
            logger.warning("History empty, attempting info fallback", ticker=ticker_symbol)
            try:
                # fast_info is preferred as it avoids the heavy .info call
                info = getattr(ticker, 'fast_info', {})
                close_price = info.get('lastPrice') or info.get('last_price')
                prev_close = info.get('previousClose') or info.get('previous_close')
                
                if not close_price:
                    # Deep fallback to standard info
                    raw_info = ticker.info
                    close_price = raw_info.get('regularMarketPrice') or raw_info.get('currentPrice')
                    prev_close = raw_info.get('regularMarketPreviousClose') or raw_info.get('previousClose')
                
                if not close_price:
                    logger.error("All fallbacks failed for ticker", ticker=ticker_symbol)
                    return None
                
                close_price = float(close_price)
                open_price = close_price # Best guess
                high_price = close_price
                low_price = close_price
                volume = 0
                last_trading_day = datetime.utcnow().strftime('%Y-%m-%d')
                
                if prev_close and float(prev_close) != 0:
                    change_pct = ((close_price - float(prev_close)) / float(prev_close)) * 100
                else:
                    change_pct = 0.0
            except Exception as e:
                logger.error("Info fallback failed", ticker=ticker_symbol, error=str(e))
                return None
            
        # Sparkline data (last 1 day, 15m intervals)
        spark_hist = ticker.history(period="1d", interval="15m")
        sparkline = []
        if not spark_hist.empty:
            sparkline = [round(float(c), 2) for c in spark_hist['Close'].tolist() if c > 0]
        elif not hist.empty:
            # Fallback to the 5d history if 1d 15m fails
            sparkline = [round(float(c), 2) for c in hist['Close'].tolist()]
            
        # Capture currency and extended hours data
        currency = "USD"
        pre_market_price = None
        post_market_price = None
        
        try:
            raw_info = ticker.info
            currency = raw_info.get('currency', 'USD')
            pre_market_price = raw_info.get('preMarketPrice')
            pre_market_change = raw_info.get('preMarketChangePercent')
            post_market_price = raw_info.get('postMarketPrice')
            post_market_change = raw_info.get('postMarketChangePercent')
        except:
            try:
                currency = ticker.fast_info.get('currency', 'USD')
            except:
                pass

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
            'headline_links': headlines_data,
            'exchange': exchange,
            'company_name': company_name,
            'sparkline': sparkline,
            'currency': currency,
            'last_trading_day': last_trading_day,
            'is_open': is_market_open(ticker_symbol, exchange),
            'pre_market_price': pre_market_price,
            'pre_market_change': pre_market_change,
            'post_market_price': post_market_price,
            'post_market_change': post_market_change
        }
    except Exception as e:
        logger.error("Error fetching ticker data", ticker=ticker_symbol, error=str(e))
        return None


def get_active_tickers() -> list[str]:
    """Fetch active tickers from the DynamoDB TrackedAssets table (paginated)."""
    table = get_table('TrackedAssets')
    try:
        items = []
        scan_kwargs = {}
        while True:
            response = table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']

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
        'headline_links': json.dumps(data.get('headline_links', [])),
        'exchange': data.get('exchange', ''),
        'company_name': data.get('company_name', ''),
        'sparkline': [Decimal(str(p)) for p in data.get('sparkline', [])],
        'currency': data.get('currency', 'USD'),
        'last_trading_day': data.get('last_trading_day'),
        'is_open': data.get('is_open', False),
        'data_hash': data_hash,
        'ttl': ttl
    }
    
    try:
        table.put_item(Item=item)
        
        # Once inserted, synthesize immediately
        from src.synthesis.service import synthesize_single_insight
        synthesize_single_insight(item)
        return True
    except Exception as e:
        logger.error("Failed to force ingest ticker", ticker=ticker, error=str(e), exc_info=True)
        return False


def ingest_market_data():
    """Runs on a schedule to fetch and store market data."""
    logger.info("Starting market data ingestion")
    table = get_table('MarketData')
    
    timestamp = datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60)  # 30 days
    
    tickers = get_active_tickers()
    success_count = 0
    for t in tickers:
        data = fetch_ticker_data(t)
        if not data:
            continue
            
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
            'headline_links': json.dumps(data.get('headline_links', [])),
            'exchange': data.get('exchange', ''),
            'company_name': data.get('company_name', ''),
            'sparkline': [Decimal(str(p)) for p in data.get('sparkline', [])],
            'currency': data.get('currency', 'USD'),
            'last_trading_day': data.get('last_trading_day'),
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
