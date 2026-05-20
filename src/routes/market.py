from fastapi import APIRouter, HTTPException, Query, Request
from src.clients.dynamo import get_table
from boto3.dynamodb.conditions import Key
import yfinance as yf
import pandas as pd
import structlog
import json
import time
import requests
def extract_ticker_series(df: pd.DataFrame, ticker: str) -> pd.Series:
    """
    Robustly extract the 'Close' series for a specific ticker from a yfinance DataFrame.
    Handles MultiIndex (Attribute, Ticker), (Ticker, Attribute), and single-ticker Index.
    """
    if df.empty:
        return pd.Series()
    
    # 1. Handle MultiIndex
    if isinstance(df.columns, pd.MultiIndex):
        # Try Attribute first (standard yfinance)
        if 'Close' in df.columns.levels[0] and ticker in df['Close'].columns:
            return df['Close'][ticker]
        # Try Ticker first (group_by='ticker')
        if ticker in df.columns.levels[0] and 'Close' in df[ticker].columns:
            return df[ticker]['Close']
        # Try cross-section search if levels are weird
        try:
            return df.xs(key=ticker, axis=1, level='Ticker')['Close']
        except:
            try:
                return df.xs(key=ticker, axis=1, level=1)['Close']
            except:
                pass
    
    # 2. Handle Single Ticker Index
    if 'Close' in df.columns:
        return df['Close']
        
    return pd.Series(0.0, index=df.index)


from src.limiter import limiter
from src.ingestion.service import get_active_tickers, is_market_open

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
    "1d":  "1d",
    "1w":  "5d",
    "5d":  "5d",
    "1m":  "1mo",
    "1mo": "1mo",
    "3m":  "3mo",
    "3mo": "3mo",
    "6m":  "6mo",
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
                    "last_trading_day": v.get("last_trading_day"),
                    "is_open": is_market_open(v["ticker"], v.get("exchange", "")),
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
    """Return OHLCV history + analyst recommendations + real-time headlines + timeline status."""
    ticker = ticker.upper().strip()
    yf_period = PERIOD_MAP.get(period, "3mo")
    
    from src.ingestion.service import get_market_status_desc, fetch_headlines

    CURATED_DESCRIPTIONS = {
        "^AXJO": "The S&P/ASX 200 index is Australia's premier stock market benchmark, measuring the performance of the 200 largest index-eligible stocks listed on the Australian Securities Exchange (ASX).",
        "^GSPC": "The S&P 500 is a widely regarded benchmark index tracking the stock performance of 500 of the largest publicly traded companies listed on stock exchanges in the United States.",
        "^IXIC": "The Nasdaq Composite is a major stock market index that tracks more than 2,500 common equities listed on the Nasdaq stock exchange, with a heavy weighting toward technology and growth sectors.",
        "^STOXX50E": "The EURO STOXX 50 is a blue-chip stock index for eurozone companies, designed to provide a representation of the leading supersector leaders in the region.",
        "^FTSE": "The FTSE 100 Index is a share index of the 100 highly capitalized blue-chip companies listed on the London Stock Exchange, serving as a key barometer for the UK economy.",
        "^GDAXI": "The DAX is a blue-chip stock market index consisting of 40 major German companies trading on the Frankfurt Stock Exchange, serving as the primary benchmark for the German equity market.",
        "^GSPTSE": "The S&P/TSX Composite Index is the premier benchmark index for the Canadian equity market, tracking the performance of the largest and most liquid companies listed on the Toronto Stock Exchange (TSX).",
        "^N225": "The Nikkei 225 is the leading and most-watched stock market index for the Tokyo Stock Exchange in Japan, featuring a price-weighted measure of 225 premier Japanese companies.",
        "^HSI": "The Hang Seng Index is a freefloat-adjusted market-capitalization-weighted stock market index in Hong Kong, tracking the performance of the largest and most liquid companies on the Hong Kong Stock Exchange.",
        "GC=F": "Gold futures are liquid financial contracts traded on COMEX, representing an agreement to buy or sell physical gold at a specified price and date. Gold is widely recognized as a safe-haven asset and inflation hedge.",
        "SI=F": "Silver futures are standardized exchange-traded contracts on COMEX, allowing market participants to trade silver. Silver is valued both as a precious metal and as a vital industrial material in electronics and solar energy.",
        "HG=F": "Copper futures trade on COMEX, serving as a global benchmark for industrial metals. Often referred to as 'Dr. Copper' due to its ability to diagnose the health of the global economy, copper is essential in construction, wiring, and electronics.",
        "PL=F": "Platinum futures are traded on NYMEX. Platinum is an exceptionally rare precious metal with major industrial applications, particularly in automotive catalytic converters and hydrogen fuel cell technologies.",
        "PA=F": "Palladium futures trade on NYMEX, representing a rare precious metal primarily utilized in automobile catalytic converters to control emissions, as well as in chemical and electronic industries.",
        "CL=F": "West Texas Intermediate (WTI) Crude Oil futures are the world's most actively traded energy contracts, trading on NYMEX. WTI is a light, sweet crude oil serving as a primary global benchmark for energy pricing."
    }

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
        
        # Fallback for closed markets (1d -> 5d, 5d -> 1mo)
        if hist.empty:
            if yf_period == "1d":
                logger.info("1d history empty, falling back to 5d", ticker=ticker)
                yf_period = "5d"
                interval = "15m"
                hist = t.history(period=yf_period, interval=interval)
            elif yf_period == "5d":
                logger.info("5d history empty, falling back to 1mo", ticker=ticker)
                yf_period = "1mo"
                interval = "1d"
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
                "target_low":      raw_info.get("targetLowPrice", None),
                "target_high":     raw_info.get("targetHighPrice", None),
                "recommendation":  raw_info.get("recommendationKey", None),
                "business_summary": (raw_info.get("longBusinessSummary", "") or "")[:3000],
            }
        except Exception:
            info = {"name": ticker}

        # Apply curated fallbacks for indices and commodities if business summary is empty
        if "business_summary" not in info or not info["business_summary"] or info["business_summary"].strip() == "":
            if ticker in CURATED_DESCRIPTIONS:
                info["business_summary"] = CURATED_DESCRIPTIONS[ticker]
            else:
                info["business_summary"] = ""

        # Fetch market open time and timeline percentages
        status_info = get_market_status_desc(ticker, info.get("exchange", ""))
        market_timeline = status_info.get("market_timeline", None)
        if market_timeline:
            market_timeline["status"] = status_info.get("status", "Closed")
            market_timeline["message"] = status_info.get("message", "")

        # Fetch latest news headlines
        news = fetch_headlines(ticker, max_count=5)
        
        return {
            "ticker": ticker,
            "period": period,
            "ohlcv": ohlcv,
            "analyst_summary": analyst_summary,
            "info": info,
            "market_timeline": market_timeline,
            "news": news
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
    period: str = Query(default="3mo")
):
    """
    Fetch sparkline close-price arrays for multiple tickers using parallel threads
    and granular ticker-level caching. Returns prices and timestamps.
    """
    global _ticker_history_cache

    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No symbols provided")

    yf_period = PERIOD_MAP.get(period, "3mo")
    
    # Discovery resolution mapping
    res_map = {
        "1d": "15m",
        "5d": "1h",
        "1mo": "1d",
        "3mo": "1d",
        "6mo": "1d",
        "ytd": "1d",
        "1y": "1wk",
        "5y": "1mo",
        "max": "1mo"
    }
    interval = res_map.get(yf_period, "1d")
    
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

    # 2. Native Batch Fetch (Proven Reliable for daily data)
    # If everything is cached, we still need timestamps.
    fetch_list = tickers_to_fetch.copy()
    if not fetch_list and symbol_list:
        fetch_list = [symbol_list[0]] # Fetch one to get timestamps

    batch_df = pd.DataFrame()
    if fetch_list:
        try:
            batch_df = yf.download(fetch_list, period=yf_period, interval=interval, progress=False)
            
            # Fallback for closed markets (batch level)
            if batch_df.empty and yf_period == "1d":
                logger.info("1d batch empty, falling back to 5d", symbols=fetch_list)
                yf_period = "5d"
                interval = "1h"
                batch_df = yf.download(fetch_list, period=yf_period, interval=interval, progress=False)

            # Align all tickers to the same index by using the full batch_df
            full_index = batch_df.index
            for ticker in tickers_to_fetch:
                try:
                    series = extract_ticker_series(batch_df, ticker)
                    cleaned = series.reindex(full_index).ffill().fillna(0.0).tolist()
                    
                    # Update granular cache
                    cache_key = f"{ticker}:{yf_period}:{interval}"
                    _ticker_history_cache[cache_key] = {
                        "data": cleaned,
                        "last_fetch": time.time()
                    }
                    result_data[ticker] = cleaned
                except Exception as e:
                    logger.warning("batch-history: extraction failed", symbol=ticker, error=str(e))
                    result_data[ticker] = [0.0] * len(batch_df)
        except Exception as e:
            logger.error("batch-history: native batch fetch failed", error=str(e))
            for t in tickers_to_fetch:
                result_data[t] = []

    # Include timestamps for frontend chart alignment
    timestamps = []
    if not batch_df.empty:
        try:
            timestamps = [t.isoformat() for t in batch_df.index]
        except:
            timestamps = [str(t) for t in batch_df.index]
    
    return {"data": result_data, "timestamps": timestamps}

@router.get("/market/master-history")
@limiter.limit("60/minute")
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

    result: dict = {"symbols": symbol_list, "data": {}, "timestamps": []}
    try:
        # Fetch data with auto_adjust to handle splits/dividends
        data = yf.download(
            symbol_list,
            period="1y",
            interval="1d",
            progress=False,
            auto_adjust=True
        )

        if data.empty:
            return result

        # Extract timestamps once from the index
        try:
            result["timestamps"] = [t.isoformat() for t in data.index]
        except:
            result["timestamps"] = [str(t) for t in data.index]

        # Process each symbol
        full_index = data.index
        for sym in symbol_list:
            try:
                series = extract_ticker_series(data, sym)
                # Ensure perfect alignment and forward-fill
                result["data"][sym] = series.reindex(full_index).ffill().fillna(0.0).tolist()
            except Exception as e:
                logger.warning("master-history: symbol failed", symbol=sym, error=str(e))
                result["data"][sym] = [0.0] * len(data)

    except Exception as e:
        logger.error("master-history: download failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    _master_history_cache[cache_key] = {"data": result, "last_fetch": time.time()}
    return result


# ─── Fundamentals cache ───────────────────────────────────────────────────────
_fundamentals_cache: dict = {}
_FUNDAMENTALS_CACHE_TTL = 86400  # 24 hours

@router.get("/market/fundamentals/{ticker}")
@limiter.limit("30/minute")
def get_ticker_fundamentals(request: Request, ticker: str):
    """
    Fetch heavy quantitative data (Financials, Ownership, Dividends) 
    decoupled from the fast history chart endpoint.
    """
    global _fundamentals_cache
    ticker = ticker.upper().strip()
    
    # Check cache
    cached = _fundamentals_cache.get(ticker)
    if cached and time.time() - cached["last_fetch"] < _FUNDAMENTALS_CACHE_TTL:
        return cached["data"]
        
    try:
        t = yf.Ticker(ticker)
        
        # 1. Financial Statements
        financials = {"periods": [], "revenue": [], "gross_profit": [], "operating_income": [], "net_income": []}
        try:
            inc = t.income_stmt
            if not inc.empty:
                # yfinance returns dates as columns, newest first. Let's take up to 4 years and reverse for chronological order
                cols = list(inc.columns)[:4]
                cols.reverse()
                
                for col in cols:
                    financials["periods"].append(col.strftime('%Y'))
                    
                    # Extract rows safely
                    def get_val(keys):
                        for k in keys:
                            if k in inc.index:
                                val = inc.loc[k, col]
                                if not pd.isna(val):
                                    return float(val)
                        return 0.0
                        
                    financials["revenue"].append(get_val(["Total Revenue", "Operating Revenue"]))
                    financials["gross_profit"].append(get_val(["Gross Profit"]))
                    financials["operating_income"].append(get_val(["Operating Income", "EBIT"]))
                    financials["net_income"].append(get_val(["Net Income", "Net Income Common Stockholders"]))
        except Exception as e:
            logger.warning("Fundamentals: Failed to fetch income stmt", ticker=ticker, error=str(e))
            
        # 2. Ownership
        ownership = {"institutions": 0.0, "insiders": 0.0, "public": 100.0}
        try:
            holders = t.major_holders
            if holders is not None and not holders.empty:
                # Structure: index 'Breakdown', col 'Value'
                if 'Value' in holders.columns:
                    val_col = holders['Value']
                    insiders = float(val_col.get('insidersPercentHeld', 0.0)) * 100
                    institutions = float(val_col.get('institutionsPercentHeld', 0.0)) * 100
                    public = max(0.0, 100.0 - insiders - institutions)
                    
                    ownership = {
                        "institutions": round(institutions, 2),
                        "insiders": round(insiders, 2),
                        "public": round(public, 2)
                    }
        except Exception as e:
            logger.warning("Fundamentals: Failed to fetch ownership", ticker=ticker, error=str(e))
            
        # 3. Dividends
        dividends = []
        try:
            divs = t.dividends
            if divs is not None and not divs.empty:
                # Get last 12 dividends
                recent_divs = divs.tail(12).iloc[::-1] # latest first
                for dt, amount in recent_divs.items():
                    dividends.append({
                        "date": dt.strftime('%Y-%m-%d'),
                        "amount": round(float(amount), 4)
                    })
        except Exception as e:
            logger.warning("Fundamentals: Failed to fetch dividends", ticker=ticker, error=str(e))
            
        result = {
            "ticker": ticker,
            "financials": financials,
            "ownership": ownership,
            "dividends": dividends
        }
        
        _fundamentals_cache[ticker] = {"data": result, "last_fetch": time.time()}
        return result
        
    except Exception as e:
        logger.error("Failed to fetch fundamentals", ticker=ticker, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── EPS cache ─────────────────────────────────────────────────────────────
_eps_cache: dict = {}
_EPS_CACHE_TTL = 86400  # 24 hours

@router.get("/market/eps/{ticker}")
@limiter.limit("30/minute")
def get_ticker_eps(request: Request, ticker: str):
    """
    Fetch historical EPS actual vs estimate vs surprise.
    """
    global _eps_cache
    ticker = ticker.upper().strip()
    
    # Check cache
    cached = _eps_cache.get(ticker)
    if cached and time.time() - cached["last_fetch"] < _EPS_CACHE_TTL:
        return cached["data"]
        
    try:
        t = yf.Ticker(ticker)
        eps_data = []
        
        try:
            # yfinance returns pandas DataFrame for get_earnings_history
            # It lists recent earnings first
            df = t.get_earnings_history()
            if df is not None and not df.empty:
                # Handle dates in index
                for index, row in df.iterrows():
                    # Parse index date safely
                    date_str = ""
                    if hasattr(index, "strftime"):
                        date_str = index.strftime('%Y-%m-%d')
                    else:
                        date_str = str(index)
                    
                    # Convert to float and format defensively
                    def clean_val(val):
                        if pd.isna(val) or val is None:
                            return None
                        return round(float(val), 2)
                    
                    raw_surprise = row.get("surprisePercent")
                    surprise_val = None
                    if raw_surprise is not None and not pd.isna(raw_surprise):
                        # typically decimal (e.g. 0.05 for 5%)
                        surprise_val = round(float(raw_surprise) * 100, 2)
                        
                    eps_data.append({
                        "date": date_str,
                        "estimate": clean_val(row.get("epsEstimate")),
                        "reported": clean_val(row.get("epsActual")),
                        "surprise": surprise_val
                    })
        except Exception as e:
            logger.warning("EPS: Failed to fetch earnings history", ticker=ticker, error=str(e))
            
        result = {
            "ticker": ticker,
            "eps": eps_data
        }
        
        _eps_cache[ticker] = {"data": result, "last_fetch": time.time()}
        return result
        
    except Exception as e:
        logger.error("Failed to fetch EPS history", ticker=ticker, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
