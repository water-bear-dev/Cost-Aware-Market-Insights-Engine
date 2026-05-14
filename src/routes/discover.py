from fastapi import APIRouter, Request
import yfinance as yf
import structlog
import time
import urllib.request
import xml.etree.ElementTree as ET
from src.limiter import limiter

import math
from datetime import datetime

router = APIRouter()
logger = structlog.get_logger(__name__)

def clean_float(val, default=0.0):
    """Ensure value is a JSON-compliant float (no NaN/Inf)."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default

# ─── Index & Commodity definitions ────────────────────────────────────────────
REGIONS = [
    {"region": "Australia",    "flag": "🇦🇺", "indices": [
        {"name": "ASX 200",     "symbol": "^AXJO"},
    ]},
    {"region": "United States","flag": "🇺🇸", "indices": [
        {"name": "S&P 500",     "symbol": "^GSPC"},
        {"name": "Nasdaq",      "symbol": "^IXIC"},
    ]},
    {"region": "Europe",       "flag": "🇪🇺", "indices": [
        {"name": "Euro Stoxx 50","symbol": "^STOXX50E"},
        {"name": "FTSE 100",    "symbol": "^FTSE"},
    ]},
    {"region": "Asia",         "flag": "🌏", "indices": [
        {"name": "Nikkei 225",  "symbol": "^N225"},
        {"name": "Hang Seng",   "symbol": "^HSI"},
    ]},
]

COMMODITIES = [
    {"name": "Gold",      "symbol": "GC=F", "icon": "🥇", "unit": "oz"},
    {"name": "Silver",    "symbol": "SI=F", "icon": "🥈", "unit": "oz"},
    {"name": "Copper",    "symbol": "HG=F", "icon": "🥉", "unit": "lb"},
    {"name": "Platinum",  "symbol": "PL=F", "icon": "💎", "unit": "oz"},
    {"name": "Palladium", "symbol": "PA=F", "icon": "⚙️", "unit": "oz"},
    {"name": "WTI Oil",   "symbol": "CL=F", "icon": "🛢️", "unit": "bbl"},
]

MOVERS_UNIVERSE = [
    "AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","UNH",
    "JNJ","WMT","PG","MA","HD","DIS","NFLX","ADBE","CRM","INTC",
    "AMD","QCOM","CSCO","TXN","MCD","NKE","SBUX","COST","AMGN","ABBV",
    "LLY","PFE","MRK","TMO","ABT","CVX","XOM","BAC","GS","MS",
    "C","WFC","BLK","AXP","SPGI","BA","CAT","GE","HON","RTX",
    "LMT","DE","T","VZ","TMUS","CHTR","CMCSA","PYPL","SQ","SHOP",
    "UBER","LYFT","ABNB","COIN","PLTR","RIVN","LCID","NIO","BABA","JD",
    # Australia (ASX)
    "CBA.AX","BHP.AX","CSL.AX","NAB.AX","ANZ.AX","WBC.AX","RIO.AX","WES.AX","MQG.AX","WOW.AX",
    "FMG.AX","TLS.AX","WDS.AX","XRO.AX","REH.AX",
    # Asia (HK, JP)
    "9984.T","7203.T","6758.T","0700.HK","9988.HK","3690.HK","1299.HK","2318.HK","1810.HK",
    # Europe (LSE, Euronext)
    "VOD.L","HSBA.L","BP.L","SHEL.L","AZN.L","GSK.L","MC.PA","OR.PA","ASML.AS","SAP.DE",
    # India (NSE)
    "RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","ICICIBANK.NS",
    # Canada (TSX)
    "RY.TO","TD.TO","SHOP.TO","CP.TO","CNQ.TO"
]

# ─── In-memory caches ─────────────────────────────────────────────────────────
_indices_cache: dict = {"data": None, "last_fetch": 0.0}
_movers_cache: dict  = {"data": None, "last_fetch": 0.0}
_news_cache: dict    = {"data": None, "last_fetch": 0.0}


# ─── Internal fetch helpers ───────────────────────────────────────────────────
def _fetch_indices() -> dict:
    """Fetch live prices for all regional indices and commodities."""
    all_symbols = (
        [idx["symbol"] for r in REGIONS for idx in r["indices"]]
        + [c["symbol"] for c in COMMODITIES]
    )
    result = {"regions": [], "commodities": []}
    try:
        tickers_obj = yf.Tickers(" ".join(all_symbols))

        for region_def in REGIONS:
            region_entry = {"region": region_def["region"], "flag": region_def["flag"], "indices": []}
            for idx in region_def["indices"]:
                try:
                    t = tickers_obj.tickers.get(idx["symbol"])
                    if not t:
                        continue
                    fi = t.fast_info
                    price = clean_float(getattr(fi, "last_price", 0))
                    prev  = clean_float(getattr(fi, "previous_close", 0))
                    if prev == 0: prev = price
                    change_pct = round(((price - prev) / prev * 100) if prev else 0, 2)
                    region_entry["indices"].append({
                        "name": idx["name"],
                        "symbol": idx["symbol"],
                        "price": round(price, 2),
                        "change_pct": change_pct,
                        "currency": getattr(fi, "currency", "USD") or "USD",
                    })
                except Exception as e:
                    logger.warning("Index fetch failed", symbol=idx["symbol"], error=str(e))
            result["regions"].append(region_entry)

        for c in COMMODITIES:
            try:
                t = tickers_obj.tickers.get(c["symbol"])
                if not t:
                    continue
                fi = t.fast_info
                price = clean_float(getattr(fi, "last_price", 0))
                prev  = clean_float(getattr(fi, "previous_close", 0))
                if prev == 0: prev = price
                change_pct = round(((price - prev) / prev * 100) if prev else 0, 2)
                result["commodities"].append({
                    "name": c["name"],
                    "symbol": c["symbol"],
                    "icon": c["icon"],
                    "unit": c["unit"],
                    "price": round(price, 2),
                    "change_pct": change_pct,
                    "currency": "USD",
                })
            except Exception as e:
                logger.warning("Commodity fetch failed", symbol=c["symbol"], error=str(e))

    except Exception as e:
        logger.error("Failed to fetch indices", error=str(e))

    return result


# Ticker → company name lookup cache (populated lazily)
_ticker_name_cache: dict = {}

def _get_company_name(sym: str) -> str:
    """Return a short company name for the ticker, using a cache."""
    if sym in _ticker_name_cache:
        return _ticker_name_cache[sym]
    try:
        info = yf.Ticker(sym).fast_info
        # fast_info doesn't have name; fall back to .info
        name = yf.Ticker(sym).info.get("shortName") or yf.Ticker(sym).info.get("longName", sym)
    except Exception:
        name = sym
    _ticker_name_cache[sym] = name
    return name


def _fetch_movers() -> dict:
    """Scan the movers universe and return top 10 gainers and losers for All, US, and Internationals."""
    try:
        import pandas as pd
        data = yf.download(MOVERS_UNIVERSE, period="2d", interval="1d",
                           progress=False, group_by="ticker", auto_adjust=True)
        
        raw_movers = []
        for sym in MOVERS_UNIVERSE:
            try:
                if isinstance(data.columns, pd.MultiIndex):
                    if sym in data.columns.get_level_values(0):
                        prices = data[sym]["Close"].dropna()
                    else:
                        continue
                else:
                    if "Close" in data.columns:
                        prices = data["Close"].dropna()
                    else:
                        continue

                if prices is None or len(prices) < 2:
                    continue
                prev  = clean_float(prices.iloc[-2])
                curr  = clean_float(prices.iloc[-1])
                change_pct = round(((curr - prev) / prev * 100) if prev else 0, 2)
                raw_movers.append({"ticker": sym, "price": round(curr, 2), "change_pct": change_pct})
            except Exception:
                pass

        def get_category_movers(subset):
            subset.sort(key=lambda x: x["change_pct"], reverse=True)
            gainers = subset[:10]
            losers  = list(reversed(subset[-10:]))
            return gainers, losers

        # Categorize
        movers_all = raw_movers
        movers_us  = [m for m in raw_movers if "." not in m["ticker"]]
        movers_int = [m for m in raw_movers if "." in m["ticker"]]

        # Get top 10s for each
        all_gain, all_lose = get_category_movers(movers_all)
        us_gain,  us_lose  = get_category_movers(movers_us)
        int_gain, int_lose = get_category_movers(movers_int)

        # Enrichment helper using Parallel Processing
        def enrich_single(m):
            sym = m["ticker"]
            try:
                # 1. Quick check for name cache
                if sym in _ticker_name_cache:
                    m["company_name"] = _ticker_name_cache[sym]
                
                # 2. Fetch full info
                t = yf.Ticker(sym)
                info = t.info
                m["company_name"] = info.get("shortName") or info.get("longName") or sym
                m["pre_market_price"] = info.get("preMarketPrice")
                m["pre_market_change"] = info.get("preMarketChangePercent")
                m["post_market_price"] = info.get("postMarketPrice")
                m["post_market_change"] = info.get("postMarketChangePercent")
                m["currency"] = info.get("currency", "USD")
                _ticker_name_cache[sym] = m["company_name"]
            except:
                m["company_name"] = _ticker_name_cache.get(sym, sym)
            return m

        # Parallelize the network-heavy enrichment calls
        from concurrent.futures import ThreadPoolExecutor
        all_to_enrich = all_gain + all_lose + us_gain + us_lose + int_gain + int_lose
        
        # Filter unique tickers to avoid duplicate calls
        unique_tickers = {}
        for m in all_to_enrich:
            if m["ticker"] not in unique_tickers:
                unique_tickers[m["ticker"]] = m

        with ThreadPoolExecutor(max_workers=10) as executor:
            executor.map(enrich_single, unique_tickers.values())

        return {
            "all": {"gainers": all_gain, "losers": all_lose},
            "us":  {"gainers": us_gain,  "losers": us_lose},
            "international": {"gainers": int_gain, "losers": int_lose},
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    except Exception as e:
        logger.error("Failed to fetch movers", error=str(e))
        return {
            "all": {"gainers": [], "losers": []},
            "us":  {"gainers": [], "losers": []},
            "international": {"gainers": [], "losers": []},
            "as_of": None
        }



def _clean_html(raw: str) -> str:
    """Strip HTML tags from a string."""
    import re
    return re.sub(r"<[^>]+>", "", raw).strip()


def _fetch_news() -> dict:
    """Fetch top 10 market news headlines from Google News RSS (no API key needed)."""
    articles = []
    try:
        url = "https://news.google.com/rss/search?q=stock+market&hl=en-US&gl=US&ceid=US:en"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
        root = ET.fromstring(raw)
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else []
        for item in items[:10]:
            source_el = item.find("source")
            raw_desc = item.findtext("description", "") or ""
            clean_desc = _clean_html(raw_desc)
            # Truncate to ~200 chars
            if len(clean_desc) > 200:
                clean_desc = clean_desc[:197] + "..."
            pub_date_raw = item.findtext("pubDate", "")
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(pub_date_raw)
                timestamp_iso = dt.isoformat()
                tz_name = dt.tzname() or "UTC"
            except:
                timestamp_iso = None
                tz_name = "UTC"

            articles.append({
                "title":       item.findtext("title", ""),
                "url":         item.findtext("link", ""),
                "source":      source_el.text if source_el is not None else "",
                "published":   pub_date_raw,
                "timestamp":   timestamp_iso,
                "timezone":    tz_name,
                "description": clean_desc,
            })
        
        # Explicitly sort by publication date (newest first)
        from email.utils import parsedate_to_datetime
        def parse_date(art):
            try:
                return parsedate_to_datetime(art["published"])
            except:
                return datetime.min
        
        articles.sort(key=parse_date, reverse=True)

    except Exception as e:
        logger.error("Failed to fetch news", error=str(e))
    return {"articles": articles, "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


# ─── Public refresh function (called at startup / by scheduler) ───────────────
def refresh_discover_caches():
    """Pre-warm all discover caches. Safe to call in a background thread."""
    global _indices_cache, _movers_cache, _news_cache
    logger.info("Pre-warming Discover caches...")
    try:
        _indices_cache["data"] = _fetch_indices()
        _indices_cache["last_fetch"] = time.time()
        logger.info("Discover indices cache warmed")
    except Exception as e:
        logger.error("Failed to warm indices cache", error=str(e))
    try:
        _movers_cache["data"] = _fetch_movers()
        _movers_cache["last_fetch"] = time.time()
        logger.info("Discover movers cache warmed")
    except Exception as e:
        logger.error("Failed to warm movers cache", error=str(e))
    try:
        _news_cache["data"] = _fetch_news()
        _news_cache["last_fetch"] = time.time()
        logger.info("Discover news cache warmed")
    except Exception as e:
        logger.error("Failed to warm news cache", error=str(e))


# ─── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/discover/refresh")
@router.post("/discover/refresh")
@limiter.limit("5/minute")
async def trigger_global_refresh(request: Request):
    """Force-refresh all discover caches and trigger the Discovery Agent DAG immediately."""
    logger.info("Manual Discovery Refresh Triggered")
    
    # Try to parse tickers from body if it's a POST
    target_tickers = []
    if request.method == "POST":
        try:
            body = await request.json()
            target_tickers = body.get("tickers", [])
        except:
            pass

    # Trigger everything in a background thread to return immediately
    def _run_refresh_tasks(tickers_to_refine):
        try:
            # 1. Clear/Refresh local market caches (cheap/non-AI)
            refresh_discover_caches()
            
            # 2. Trigger the Discovery DAG (expensive AI)
            # We run this if tickers are provided (targeted refresh) 
            # OR if no tickers are provided (Full 12-hour style refresh/Reset)
            if tickers_to_refine:
                from src.dag.discovery_graph import discovery_dag
                dag_input = {"universe": [], "messages": []}
                
                # 3-way split for Global Opportunity support
                dag_input["sp500_universe"] = [t for t in tickers_to_refine if "." not in t][:1]
                dag_input["international_universe"] = [t for t in tickers_to_refine if "." in t][:1]
                used = set(dag_input["sp500_universe"] + dag_input["international_universe"])
                dag_input["hidden_gems_universe"] = [t for t in tickers_to_refine if t not in used][:1]
                
                logger.info("Auto-Healing: Refining specific discovery tickers", tickers=tickers_to_refine)
                discovery_dag.invoke(dag_input)
            else:
                # STRICT SKIP: Manual refresh only updates cheap market caches
                logger.info("Manual Global Refresh: Market caches updated, Discovery DAG skipped to save tokens")
            
            logger.info("Manual Discovery Refresh task completed")
        except Exception as e:
            logger.error("Manual Discovery task failed", error=str(e))
            
    import threading
    threading.Thread(target=_run_refresh_tasks, args=(target_tickers,), daemon=True).start()
    
    return {"status": "refresh_triggered", "message": "Discovery Agent and Market Caches are being refreshed in the background."}


@router.get("/discover/indices")
@limiter.limit("30/minute")
def get_indices(request: Request):
    """Returns live regional market indices and commodity prices. Cache TTL: 5 min."""
    global _indices_cache
    if not _indices_cache["data"] or time.time() - _indices_cache["last_fetch"] > 300:
        logger.info("Discover: fetching indices (cache miss or expired)")
        _indices_cache["data"] = _fetch_indices()
        _indices_cache["last_fetch"] = time.time()
    return _indices_cache["data"]


@router.get("/discover/movers")
@limiter.limit("20/minute")
def get_movers(request: Request):
    """
    Returns today's top 10 gainers and losers. 
    Uses Stale-While-Revalidate pattern: 
    - Serves cached data instantly if available.
    - If data is older than 15 mins (900s), triggers a background refresh.
    """
    global _movers_cache
    
    current_time = time.time()
    ttl = 900  # 15 minutes
    
    # 1. If cache is completely empty, we must fetch synchronously once
    if not _movers_cache["data"]:
        logger.info("Discover: First-time movers fetch (synchronous)")
        _movers_cache["data"] = _fetch_movers()
        _movers_cache["last_fetch"] = current_time
        return _movers_cache["data"]

    # 2. If cache is expired (>15 mins), trigger background refresh but return stale data
    if current_time - _movers_cache["last_fetch"] > ttl:
        logger.info("Discover: Movers cache expired, triggering background refresh")
        
        def _bg_refresh():
            try:
                new_data = _fetch_movers()
                if new_data and new_data.get("all", {}).get("gainers"):
                    _movers_cache["data"] = new_data
                    _movers_cache["last_fetch"] = time.time()
                    logger.info("Discover: Movers cache background refresh complete")
            except Exception as e:
                logger.error("Background movers refresh failed", error=str(e))

        import threading
        threading.Thread(target=_bg_refresh, daemon=True).start()

    # 3. Always return whatever we have in cache (fast path)
    return _movers_cache["data"]


@router.get("/discover/news")
@limiter.limit("30/minute")
def get_news(request: Request):
    """Returns 10 most recent market headlines. Cache TTL: 1 hour; force-refreshes if cache empty."""
    global _news_cache
    empty   = not _news_cache["data"] or not _news_cache["data"].get("articles")
    expired = time.time() - _news_cache["last_fetch"] > 3600
    if empty or expired:
        logger.info("Discover: fetching news (cache miss or expired)")
        _news_cache["data"] = _fetch_news()
        _news_cache["last_fetch"] = time.time()
    return _news_cache["data"]
