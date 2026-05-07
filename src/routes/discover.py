from fastapi import APIRouter, Request
import yfinance as yf
import structlog
import time
import urllib.request
import xml.etree.ElementTree as ET
from src.limiter import limiter

import math

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
    {"name": "Gold",    "symbol": "GC=F", "icon": "🥇", "unit": "oz"},
    {"name": "WTI Oil", "symbol": "CL=F", "icon": "🛢️", "unit": "bbl"},
    {"name": "Silver",  "symbol": "SI=F", "icon": "🥈", "unit": "oz"},
]

MOVERS_UNIVERSE = [
    "AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","UNH",
    "JNJ","WMT","PG","MA","HD","DIS","NFLX","ADBE","CRM","INTC",
    "AMD","QCOM","CSCO","TXN","MCD","NKE","SBUX","COST","AMGN","ABBV",
    "LLY","PFE","MRK","TMO","ABT","CVX","XOM","BAC","GS","MS",
    "C","WFC","BLK","AXP","SPGI","BA","CAT","GE","HON","RTX",
    "LMT","DE","T","VZ","TMUS","CHTR","CMCSA","PYPL","SQ","SHOP",
    "UBER","LYFT","ABNB","COIN","PLTR","RIVN","LCID","NIO","BABA","JD",
    # ASX
    "CBA.AX","BHP.AX","CSL.AX","NAB.AX","ANZ.AX","WBC.AX","RIO.AX","WES.AX","MQG.AX","WOW.AX",
    # Asia
    "9984.T","7203.T","6758.T","0700.HK","9988.HK",
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
    """Scan the movers universe and return top 10 gainers and losers."""
    try:
        import pandas as pd
        data = yf.download(MOVERS_UNIVERSE, period="2d", interval="1d",
                           progress=False, group_by="ticker", auto_adjust=True)
        movers = []
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
                movers.append({"ticker": sym, "price": round(curr, 2), "change_pct": change_pct})
            except Exception:
                pass

        movers.sort(key=lambda x: x["change_pct"], reverse=True)
        top_gainers = movers[:10]
        top_losers  = list(reversed(movers[-10:]))

        # Enrich with company names (batch to avoid too many requests)
        symbols_needed = [m["ticker"] for m in top_gainers + top_losers
                          if m["ticker"] not in _ticker_name_cache]
        if symbols_needed:
            try:
                tickers_obj = yf.Tickers(" ".join(symbols_needed))
                for sym in symbols_needed:
                    t = tickers_obj.tickers.get(sym)
                    if t:
                        info = t.info
                        _ticker_name_cache[sym] = info.get("shortName") or info.get("longName", sym)
                    else:
                        _ticker_name_cache[sym] = sym
            except Exception:
                for sym in symbols_needed:
                    _ticker_name_cache[sym] = sym

        for m in top_gainers + top_losers:
            m["company_name"] = _ticker_name_cache.get(m["ticker"], m["ticker"])

        return {
            "gainers": top_gainers,
            "losers":  top_losers,
            "as_of":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    except Exception as e:
        logger.error("Failed to fetch movers", error=str(e))
        return {"gainers": [], "losers": [], "as_of": None}


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
            articles.append({
                "title":       item.findtext("title", ""),
                "url":         item.findtext("link", ""),
                "source":      source_el.text if source_el is not None else "",
                "published":   item.findtext("pubDate", ""),
                "description": clean_desc,
            })
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
@limiter.limit("10/minute")
def get_movers(request: Request):
    """Returns today's top 10 gainers and losers. Refreshed daily at 8AM AEST; force-refreshes if cache empty."""
    global _movers_cache
    empty = not _movers_cache["data"] or not _movers_cache["data"].get("gainers")
    if empty:
        logger.info("Discover: fetching movers (cache empty)")
        _movers_cache["data"] = _fetch_movers()
        _movers_cache["last_fetch"] = time.time()
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
