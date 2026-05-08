from fastapi import APIRouter, Request
import yfinance as yf
import structlog
from src.limiter import limiter

router = APIRouter()
logger = structlog.get_logger(__name__)

# Cache rates for 1 hour to avoid hitting yfinance too hard
cached_rates = {
    'USD': {'rate': 1.0,   'symbol': '$'},
    'EUR': {'rate': 0.93,  'symbol': '€'},
    'GBP': {'rate': 0.79,  'symbol': '£'},
    'AUD': {'rate': 1.52,  'symbol': 'A$'},
    'JPY': {'rate': 154.0, 'symbol': '¥'},
    'HKD': {'rate': 7.8,   'symbol': 'HK$'},
    'CAD': {'rate': 1.36,  'symbol': 'C$'},
    'SGD': {'rate': 1.35,  'symbol': 'S$'},
    'NZD': {'rate': 1.66,  'symbol': 'NZ$'},
}
last_fetch = 0

@router.get("/meta/rates")
@limiter.limit("5/minute")
def get_exchange_rates(request: Request):
    global last_fetch, cached_rates
    import time
    
    # Refresh every hour
    if time.time() - last_fetch > 3600:
        try:
            logger.info("Refreshing exchange rates from yfinance")
            # Tickers for USD to Target Currency
            pairs = {
                'EUR': 'USDEUR=X',
                'GBP': 'USDGBP=X',
                'AUD': 'USDAUD=X',
                'JPY': 'USDJPY=X',
                'HKD': 'USDHKD=X',
                'CAD': 'USDCAD=X',
                'SGD': 'USDSGD=X',
                'NZD': 'USDNZD=X'
            }
            
            # Fetch all in one go (more efficient)
            data = yf.download(list(pairs.values()), period="1d", interval="1m", progress=False)
            
            if not data.empty:
                for symbol, ticker in pairs.items():
                    try:
                        # Handle potential multi-index or single index
                        if ticker in data['Close'].columns if hasattr(data['Close'], 'columns') else [ticker]:
                            col = data['Close'][ticker] if hasattr(data['Close'], 'columns') else data['Close']
                            latest_price = col.dropna().iloc[-1]
                            if latest_price > 0:
                                cached_rates[symbol]['rate'] = round(float(latest_price), 4)
                    except Exception as ex:
                        logger.warning(f"Failed to parse rate for {symbol}", error=str(ex))
            
            last_fetch = time.time()
            logger.info("Exchange rates refreshed", rates=cached_rates)
        except Exception as e:
            logger.error("Failed to refresh exchange rates", error=str(e))
            # Fallback to existing cached_rates (initialized with defaults)
            
    return cached_rates
