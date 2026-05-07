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
    'JPY': {'rate': 154.0, 'symbol': '¥'}
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
                'JPY': 'USDJPY=X'
            }
            
            # Fetch all in one go (more efficient)
            data = yf.download(list(pairs.values()), period="1d", interval="1m", progress=False)
            
            for symbol, ticker in pairs.items():
                if ticker in data['Close']:
                    latest_price = data['Close'][ticker].iloc[-1]
                    if not isinstance(latest_price, float) or latest_price <= 0:
                        # Sometimes yfinance returns a Series or NaN
                        latest_price = float(data['Close'][ticker].dropna().iloc[-1])
                    
                    cached_rates[symbol]['rate'] = round(latest_price, 4)
            
            last_fetch = time.time()
            logger.info("Exchange rates refreshed", rates=cached_rates)
        except Exception as e:
            logger.error("Failed to refresh exchange rates", error=str(e))
            # Fallback to existing cached_rates (initialized with defaults)
            
    return cached_rates
