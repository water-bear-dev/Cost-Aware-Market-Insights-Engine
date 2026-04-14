from fastapi import APIRouter, HTTPException, Query, Request
from src.clients.dynamo import get_table
import yfinance as yf
import structlog
import json

from src.limiter import limiter
from src.ingestion.service import get_active_tickers

router = APIRouter()
logger = structlog.get_logger(__name__)

PERIOD_MAP = {
    "1d": "1d",
    "1w": "5d",
    "1mo": "1mo",
    "1y": "1y",
    "5y": "5y",
    "max": "max"
}

@router.get("/market")
@limiter.limit("60/minute")
def get_market_data(request: Request):
    table = get_table('MarketData')
    try:
        active_tickers = get_active_tickers()
        response = table.scan()
        latest = {}
        for item in response.get('Items', []):
            t = item['ticker']
            if t not in latest or item['timestamp'] > latest[t]['timestamp']:
                latest[t] = item
                
        results = []
        for t in active_tickers:
            if t in latest:
                v = latest[t]
                raw_links = v.get("headline_links", "[]")
                try:
                    headline_links = json.loads(raw_links) if isinstance(raw_links, str) else raw_links
                except Exception:
                    headline_links = []

                results.append({
                    "ticker": v["ticker"],
                    "timestamp": v["timestamp"],
                    "open_price": float(v["open_price"]),
                    "high_price": float(v["high_price"]),
                    "low_price": float(v["low_price"]),
                    "close_price": float(v["close_price"]),
                    "volume": int(v["volume"]),
                    "change_pct": float(v["change_pct"]),
                    "headlines": v.get("headlines", []),
                    "headline_links": headline_links,
                    "status": "active"
                })
            else:
                # Missing MarketData but tracked
                results.append({
                    "ticker": t,
                    "timestamp": "",
                    "open_price": 0.0,
                    "high_price": 0.0,
                    "low_price": 0.0,
                    "close_price": 0.0,
                    "volume": 0,
                    "change_pct": 0.0,
                    "headlines": [],
                    "headline_links": [],
                    "status": "pending_data"
                })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/market/history/{ticker}")
@limiter.limit("60/minute")
def get_ticker_history(request: Request, ticker: str, period: str = Query(default="1mo")):
    """Return OHLCV history + analyst recommendations for a ticker."""
    ticker = ticker.upper().strip()
    yf_period = PERIOD_MAP.get(period, "1mo")
    
    try:
        t = yf.Ticker(ticker)
        
        # Choose interval based on period
        interval_map = {
            "1d": "5m",
            "5d": "15m",
            "1mo": "1d",
            "1y": "1wk",
            "5y": "1mo",
            "max": "1mo"
        }
        interval = interval_map.get(yf_period, "1d")
        
        hist = t.history(period=yf_period, interval=interval)
        
        if hist.empty:
            raise HTTPException(status_code=404, detail=f"No history data for {ticker}")
        
        # Build OHLCV array
        ohlcv = []
        for dt, row in hist.iterrows():
            ohlcv.append({
                "time": dt.isoformat(),
                "open": round(float(row['Open']), 2),
                "high": round(float(row['High']), 2),
                "low": round(float(row['Low']), 2),
                "close": round(float(row['Close']), 2),
                "volume": int(row['Volume'])
            })
        
        # Analyst recommendations
        analyst_summary = {"buy": 0, "hold": 0, "sell": 0, "strong_buy": 0, "strong_sell": 0}
        try:
            recs = t.recommendations
            if recs is not None and not recs.empty:
                latest_rec = recs.iloc[-1]
                analyst_summary = {
                    "strong_buy": int(latest_rec.get('strongBuy', 0)),
                    "buy": int(latest_rec.get('buy', 0)),
                    "hold": int(latest_rec.get('hold', 0)),
                    "sell": int(latest_rec.get('sell', 0)),
                    "strong_sell": int(latest_rec.get('strongSell', 0))
                }
        except Exception as e:
            logger.warning("Could not fetch analyst recommendations", ticker=ticker, error=str(e))
        
        # Basic info
        info = {}
        try:
            raw_info = t.info
            info = {
                "name": raw_info.get("longName", ticker),
                "sector": raw_info.get("sector", ""),
                "market_cap": raw_info.get("marketCap", 0),
                "pe_ratio": raw_info.get("trailingPE", None),
                "52w_high": raw_info.get("fiftyTwoWeekHigh", None),
                "52w_low": raw_info.get("fiftyTwoWeekLow", None),
            }
        except Exception:
            info = {"name": ticker}
        
        return {
            "ticker": ticker,
            "period": period,
            "ohlcv": ohlcv,
            "analyst_summary": analyst_summary,
            "info": info
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to fetch history", ticker=ticker, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
