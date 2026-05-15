from fastapi import APIRouter, HTTPException, Query, Request
from src.clients.dynamo import get_table
from boto3.dynamodb.conditions import Key
import yfinance as yf
import pandas as pd
import structlog
import json
import time
import requests

from src.limiter import limiter
from src.ingestion.service import get_active_tickers

import math
from concurrent.futures import ThreadPoolExecutor, as_completed

router = APIRouter()
logger = structlog.get_logger(__name__)

# ─── Batch history cache ──────────────────────────────────────────────────────
# Structure: { "<period>": { "data": {...}, "last_fetch": float } }
_batch_history_cache: dict = {}
_BATCH_HISTORY_TTL = 300  # 5 minutes

# ─── Master history cache (1 year daily) ──────────────────────────────────────
_master_history_cache: dict = {}
_MASTER_HISTORY_TTL = 86400  # 24 hours

def sanitize_series(series):
    """
    Cleans a price series:
    1. Removes leading zeros (to avoid Infinity% errors)
    2. Forward-fills gaps (zeros/NaNs) with the previous valid price.
    """
    if not series: return []
    cleaned = []
    last_valid = None
    
    # 1. Skip leading zeros/nulls/NaNs
    start_idx = 0
    while start_idx < len(series):
        val = clean_float(series[start_idx])
        if val != 0:
            break
        start_idx += 1
    
    if start_idx == len(series):
        return []

    for val in series[start_idx:]:
        v = clean_float(val)
        if v == 0:
            if last_valid is not None:
                cleaned.append(last_valid)
            else:
                cleaned.append(0.0)
        else:
            cleaned.append(v)
            last_valid = v
            
    return cleaned

def clean_float(val, default=0.0):
    """Ensure value is a JSON-compliant float (no NaN/Inf)."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default

PERIOD_MAP = {
    "3mo": "3mo",
    "6mo": "6mo",
    "ytd": "ytd",
    "1y":  "1y",
    "5y":  "5y",
    "max": "max"
}

@router.get("/market")
@limiter.limit("60/minute")
def get_market_data(request: Request):
    table = get_table('MarketData')
    try:
        active_tickers = get_active_tickers()

        results = []
        for t in active_tickers:
            # Query only the LATEST row per ticker — avoids full table scan pagination limits
            resp = table.query(
                KeyConditionExpression=Key('ticker').eq(t),
                ScanIndexForward=False,
                Limit=1
            )
            rows = resp.get('Items', [])

            if rows:
                v = rows[0]
                raw_links = v.get("headline_links", "[]")
                try:
                    headline_links = json.loads(raw_links) if isinstance(raw_links, str) else raw_links
                except Exception:
                    headline_links = []

                results.append({
                    "ticker": v["ticker"],
                    "timestamp": v.get("timestamp", ""),
                    "open_price": clean_float(v.get("open_price", 0.0)),
                    "high_price": clean_float(v.get("high_price", 0.0)),
                    "low_price": clean_float(v.get("low_price", 0.0)),
                    "close_price": clean_float(v.get("close_price", 0.0)),
                    "volume": int(v.get("volume", 0)),
                    "change_pct": clean_float(v.get("change_pct", 0.0)),
                    "headlines": v.get("headlines", []),
                    "headline_links": headline_links,
                    "exchange": v.get("exchange", ""),
                    "company_name": v.get("company_name", ""),
                    "sparkline": [clean_float(p) for p in (v.get("sparkline") or [])],
                    "currency": v.get("currency", "USD"),
                    "status": "active"
                })
            else:
                # Ticker tracked but no MarketData row yet — show pending state
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
def get_ticker_history(request: Request, ticker: str, period: str = Query(default="3mo")):
    """Return OHLCV history + analyst recommendations for a ticker."""
    ticker = ticker.upper().strip()
    yf_period = PERIOD_MAP.get(period, "3mo")
    
    try:
        t = yf.Ticker(ticker)
        
        # Choose interval based on period
        interval_map = {
            "1d":  "5m",
            "5d":  "15m",
            "1mo": "1d",
            "3mo": "1d",
            "6mo": "1d",
            "ytd": "1d",
            "1y":  "1wk",
            "5y":  "1mo",
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
        
        # Analyst recommendations — handle modern yfinance structure
        analyst_summary = {"buy": 0, "hold": 0, "sell": 0, "strong_buy": 0, "strong_sell": 0}
        try:
            # Try getting specific counts first
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
            else:
                # Fallback: Many tickers now provide these in t.info
                raw_info = t.info
                analyst_summary = {
                    "strong_buy": int(raw_info.get('recommendationCount', {}).get('strongBuy', 0) or 0),
                    "buy": int(raw_info.get('recommendationCount', {}).get('buy', 0) or 0),
                    "hold": int(raw_info.get('recommendationCount', {}).get('hold', 0) or 0),
                    "sell": int(raw_info.get('recommendationCount', {}).get('sell', 0) or 0),
                    "strong_sell": int(raw_info.get('recommendationCount', {}).get('strongSell', 0) or 0)
                }
        except Exception as e:
            logger.warning("Could not fetch analyst recommendations", ticker=ticker, error=str(e))
        
        # Basic info — enriched for TradingView-style key stats panel
        info = {}
        try:
            raw_info = t.info
            mc = raw_info.get("marketCap", 0) or 0
            info = {
                "name":            raw_info.get("longName", ticker),
                "sector":          raw_info.get("sector", ""),
                "industry":        raw_info.get("industry", ""),
                "country":         raw_info.get("country", ""),
                "exchange":        raw_info.get("exchange", ""),
                "current_price":   raw_info.get("currentPrice", raw_info.get("regularMarketPrice", None)),
                "previous_close":  raw_info.get("previousClose", raw_info.get("regularMarketPreviousClose", None)),
                "day_open":        raw_info.get("open", raw_info.get("regularMarketOpen", None)),
                "day_high":        raw_info.get("dayHigh", raw_info.get("regularMarketDayHigh", None)),
                "day_low":         raw_info.get("dayLow", raw_info.get("regularMarketDayLow", None)),
                "market_cap":      mc,
                "market_cap_fmt":  f"${mc/1e12:.2f}T" if mc >= 1e12 else (f"${mc/1e9:.2f}B" if mc >= 1e9 else f"${mc/1e6:.0f}M"),
                "pe_ratio":        raw_info.get("trailingPE", None),
                "forward_pe":      raw_info.get("forwardPE", None),
                "eps":             raw_info.get("trailingEps", None),
                "dividend_yield":  raw_info.get("dividendYield", None),
                "beta":            raw_info.get("beta", None),
                "52w_high":        raw_info.get("fiftyTwoWeekHigh", None),
                "52w_low":         raw_info.get("fiftyTwoWeekLow", None),
                "currency":        raw_info.get("currency", "USD"),
                "avg_volume":      raw_info.get("averageVolume", None),
                "target_price":    raw_info.get("targetMeanPrice", None),
                "business_summary": (raw_info.get("longBusinessSummary", "") or "")[:3000],
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


  # ─── Granular ticker cache ──────────────────────────────────────────────────
_ticker_history_cache: dict = {}
_TICKER_CACHE_TTL = 300  # 5 minutes

@router.get("/market/batch-history")
@limiter.limit("60/minute")
def get_batch_history(
    request: Request,
    symbols: str = Query(..., description="Comma-separated ticker symbols"),
    period: str = Query(default="1d")
):
    """
    Fetch sparkline close-price arrays for multiple tickers using parallel threads
    and granular ticker-level caching.
    """
    global _ticker_history_cache

    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No symbols provided")

    yf_period = PERIOD_MAP.get(period, "3mo")
    # All Discovery timeframes (1M, 3M, 6M, 1Y) now use 1d interval for stability
    interval = "1d"
    result_data = {}
    tickers_to_fetch = []

    # 1. Pull what we can from granular cache
    for sym in symbol_list:
        cache_key = f"{sym}:{yf_period}:{interval}"
        cached = _ticker_history_cache.get(cache_key)
        if cached and (time.time() - cached["last_fetch"]) < _TICKER_CACHE_TTL:
            result_data[sym] = cached["data"]
        else:
            tickers_to_fetch.append(sym)

    if not tickers_to_fetch:
        return {"data": result_data}

    # 2. Native Batch Fetch (Proven Reliable for daily data)
    try:
        batch_df = yf.download(tickers_to_fetch, period=yf_period, interval=interval, progress=False)
        
        for ticker in tickers_to_fetch:
            try:
                closes = []
                if isinstance(batch_df.columns, pd.MultiIndex):
                    if 'Close' in batch_df.columns.levels[0] and ticker in batch_df['Close'].columns:
                        closes = batch_df['Close'][ticker].tolist()
                else:
                    # Single ticker case
                    if 'Close' in batch_df.columns:
                        closes = batch_df['Close'].tolist()

                if not closes:
                    result_data[ticker] = []
                    continue

                cleaned = sanitize_series(closes)
                
                # Update granular cache
                cache_key = f"{ticker}:{yf_period}:{interval}"
                _ticker_history_cache[cache_key] = {
                    "data": cleaned,
                    "last_fetch": time.time()
                }
                result_data[ticker] = cleaned
            except Exception as e:
                logger.warning("batch-history: extraction failed", symbol=ticker, error=str(e))
                result_data[ticker] = []

    except Exception as e:
        logger.error("batch-history: native batch fetch failed", error=str(e))
        for t in tickers_to_fetch:
            result_data[t] = []

    return {"data": result_data}

@router.get("/market/master-history")
@limiter.limit("5/minute")
def get_master_history(
    request: Request,
    symbols: str = Query(..., description="Comma-separated ticker symbols")
):
    """
    Fetch 1-year daily history for multiple symbols.
    Aggressive 24-hour caching to minimize yfinance load.
    Data is sanitized (forward-filled) before returning.
    """
    global _master_history_cache

    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No symbols provided")

    # Check cache
    cache_key = ",".join(sorted(symbol_list))
    cached = _master_history_cache.get(cache_key)
    if cached and time.time() - cached["last_fetch"] < _MASTER_HISTORY_TTL:
        return cached["data"]

    result: dict = {"symbols": symbol_list, "data": {}}
    try:
        data = yf.download(
            symbol_list,
            period="1y",
            interval="1d",
            progress=False,
            group_by="ticker",
            auto_adjust=True
        )

        for sym in symbol_list:
            try:
                import pandas as pd
                if isinstance(data.columns, pd.MultiIndex):
                    if sym not in data.columns.get_level_values(0):
                        result["data"][sym] = []
                        continue
                    closes = data[sym]["Close"].tolist()
                else:
                    closes = data["Close"].tolist() if "Close" in data.columns else []

                # Sanitize: Forward-fill gaps and strip leading zeros
                result["data"][sym] = sanitize_series(closes)
            except Exception as e:
                logger.warning("master-history: symbol failed", symbol=sym, error=str(e))
                result["data"][sym] = []

    except Exception as e:
        logger.error("master-history: download failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    _master_history_cache[cache_key] = {"data": result, "last_fetch": time.time()}
    return result

