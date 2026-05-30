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
    {"region": "Americas",     "flag": "🌎", "indices": [
        {"name": "S&P 500",     "symbol": "^GSPC", "flag": "🇺🇸"},
        {"name": "Nasdaq",      "symbol": "^IXIC", "flag": "🇺🇸"},
        {"name": "Toronto Exchange", "symbol": "^GSPTSE", "flag": "🇨🇦"},
    ]},
    {"region": "Europe",       "flag": "🇪🇺", "indices": [
        {"name": "Euro Stoxx 50","symbol": "^STOXX50E", "flag": "🇪🇺"},
        {"name": "FTSE 100",    "symbol": "^FTSE", "flag": "🇬🇧"},
        {"name": "DAX",         "symbol": "^GDAXI", "flag": "🇩🇪"},
    ]},
    {"region": "Asia Pacific", "flag": "🌏", "indices": [
        {"name": "Nikkei 225",  "symbol": "^N225", "flag": "🇯🇵"},
        {"name": "Hang Seng",   "symbol": "^HSI", "flag": "🇭🇰"},
        {"name": "ASX 200",     "symbol": "^AXJO", "flag": "🇦🇺"},
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
    # US (Americas)
    "AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","UNH",
    "JNJ","WMT","PG","MA","HD","DIS","NFLX","ADBE","CRM","INTC",
    "AMD","QCOM","CSCO","TXN","MCD","NKE","SBUX","COST","AMGN","ABBV",
    "LLY","PFE","MRK","TMO","ABT","CVX","XOM","BAC","GS","MS",
    "C","WFC","BLK","AXP","SPGI","BA","CAT","GE","HON","RTX",
    "LMT","DE","T","VZ","TMUS","CHTR","CMCSA","PYPL","SQ","SHOP",
    "UBER","LYFT","ABNB","COIN","PLTR","RIVN","LCID","NIO","BABA","JD",
    "AVGO","SMCI","MU","INTU","AMAT","ISRG","LRCX","BKNG","MDLZ","REGN",
    "VRTX","PANW","SNPS","CDNS","PDD","MELI","LULU","CRWD",
    # Canada (TSX - Americas)
    "RY.TO","TD.TO","SHOP.TO","CP.TO","CNQ.TO","CNR.TO","ENB.TO","BNS.TO","BMO.TO","ABX.TO","MFC.TO","SU.TO",
    # Australia (ASX - Asia)
    "CBA.AX","BHP.AX","CSL.AX","NAB.AX","ANZ.AX","WBC.AX","RIO.AX","WES.AX","MQG.AX","WOW.AX",
    "FMG.AX","TLS.AX","WDS.AX","XRO.AX","REH.AX","GMG.AX","ALL.AX","QAN.AX","COH.AX","APA.AX","TCL.AX","SUN.AX","IAG.AX","STO.AX",
    # Japan (TSE - Asia)
    "9984.T","7203.T","6758.T","8035.T","9983.T","6857.T","4502.T","8306.T","8316.T","7974.T","6902.T","4063.T",
    # Hong Kong (HKEX - Asia)
    "0700.HK","9988.HK","3690.HK","1299.HK","2318.HK","1810.HK","9618.HK","9888.HK","1211.HK","0388.HK","0005.HK","0939.HK","1398.HK","3988.HK",
    # India (NSE - Asia)
    "RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","ICICIBANK.NS","BHARTIARTL.NS","SBIN.NS","WIPRO.NS","ITC.NS","HINDUNILVR.NS",
    # United Kingdom (LSE - Europe)
    "VOD.L","HSBA.L","BP.L","SHEL.L","AZN.L","GSK.L","ULVR.L","RIO.L","DGE.L","BARC.L","LLOY.L",
    # France / Netherlands (Euronext - Europe)
    "MC.PA","OR.PA","ASML.AS","RMS.PA","CDI.PA","TTE.PA","SAN.PA","AIR.PA","PRX.AS","UNA.AS",
    # Germany (DAX - Europe)
    "SAP.DE","ALV.DE","SIE.DE","DTG.DE","MBG.DE","BAS.DE","BAYN.DE","VOW3.DE","DTE.DE"
]

# ─── In-memory caches ─────────────────────────────────────────────────────────
_indices_cache: dict = {"data": None, "last_fetch": 0.0}
_movers_cache: dict  = {"data": None, "last_fetch": 0.0}
_news_cache: dict    = {"data": None, "last_fetch": 0.0}
_news_summary_cache: dict = {"data": None, "last_fetch": 0.0}



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
                    
                    from src.ingestion.service import get_market_status_desc
                    status_details = get_market_status_desc(idx["symbol"])
                    market_status = status_details["status"]
                    market_status_msg = status_details["message"]

                    region_entry["indices"].append({
                        "name": idx["name"],
                        "symbol": idx["symbol"],
                        "price": round(price, 2),
                        "change_pct": change_pct,
                        "currency": getattr(fi, "currency", "USD") or "USD",
                        "market_status": market_status,
                        "market_status_msg": market_status_msg,
                        "flag": idx.get("flag", ""),
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
        movers_americas = []
        movers_europe = []
        movers_asia = []
        
        for m in raw_movers:
            ticker = m["ticker"]
            # Americas: US tickers (no suffix) or Canada (.TO)
            if "." not in ticker or ticker.endswith(".TO"):
                movers_americas.append(m)
            # Europe: UK (.L), France (.PA), Netherlands (.AS), Germany (.DE)
            elif any(ticker.endswith(sfx) for sfx in [".L", ".PA", ".AS", ".DE"]):
                movers_europe.append(m)
            # Asia / APAC: Japan (.T), Hong Kong (.HK), India (.NS), Australia (.AX)
            elif any(ticker.endswith(sfx) for sfx in [".T", ".HK", ".NS", ".AX"]):
                movers_asia.append(m)

        # Get top 10s for each
        all_gain, all_lose = get_category_movers(movers_all)
        americas_gain, americas_lose = get_category_movers(movers_americas)
        europe_gain, europe_lose = get_category_movers(movers_europe)
        asia_gain, asia_lose = get_category_movers(movers_asia)

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
        all_to_enrich = (
            all_gain + all_lose + 
            americas_gain + americas_lose + 
            europe_gain + europe_lose + 
            asia_gain + asia_lose
        )
        
        # Filter unique tickers to avoid duplicate calls
        unique_tickers = {}
        for m in all_to_enrich:
            if m["ticker"] not in unique_tickers:
                unique_tickers[m["ticker"]] = m

        with ThreadPoolExecutor(max_workers=10) as executor:
            executor.map(enrich_single, unique_tickers.values())

        return {
            "all": {"gainers": all_gain, "losers": all_lose},
            "americas": {"gainers": americas_gain, "losers": americas_lose},
            "europe": {"gainers": europe_gain, "losers": europe_lose},
            "asia": {"gainers": asia_gain, "losers": asia_lose},
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    except Exception as e:
        logger.error("Failed to fetch movers", error=str(e))
        return {
            "all": {"gainers": [], "losers": []},
            "americas": {"gainers": [], "losers": []},
            "europe": {"gainers": [], "losers": []},
            "asia": {"gainers": [], "losers": []},
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


def _extract_mentioned_tickers(news_articles: list) -> list:
    """Scan news headlines and descriptions for mentions of tickers in MOVERS_UNIVERSE."""
    import re
    mentioned = set()
    
    ticker_map = {}
    for t in MOVERS_UNIVERSE:
        base = t.split('.')[0].upper()
        ticker_map[base] = t
        ticker_map[t.upper()] = t

    COMPANY_NAME_MAP = {
        "APPLE": "AAPL",
        "MICROSOFT": "MSFT",
        "GOOGLE": "GOOGL",
        "ALPHABET": "GOOGL",
        "AMAZON": "AMZN",
        "META": "META",
        "NVIDIA": "NVDA",
        "TESLA": "TSLA",
        "JPMORGAN": "JPM",
        "VISA": "V",
        "WALMART": "WMT",
        "DISNEY": "DIS",
        "NETFLIX": "NFLX",
        "INTEL": "INTC",
        "MICRON": "MU",
        "ELI LILLY": "LLY",
        "LILLY": "LLY",
        "SHOPIFY": "SHOP",
        "UBER": "UBER",
        "COINBASE": "COIN",
        "PALANTIR": "PLTR",
        "BROADCOM": "AVGO",
        "CROWDSTRIKE": "CRWD",
    }

    for art in news_articles:
        text = (art.get("title", "") + " " + art.get("description", "")).upper()
        
        # 1. Match standard word-bounded potential tickers
        words = re.findall(r'\b[A-Z0-9\.\-=]+\b', text)
        for w in words:
            if len(w) > 1 and w in ticker_map:
                if w in ["OR", "BY", "AM", "IT", "GO", "ME", "SO", "DO", "AN"]:
                    continue
                mentioned.add(ticker_map[w])
        
        # 2. Support dollar-prefixed $V, $T, etc.
        dollar_words = re.findall(r'\$([A-Z0-9\.\-=]+)\b', text)
        for dw in dollar_words:
            if dw in ticker_map:
                mentioned.add(ticker_map[dw])

        # 3. Match common company names
        for cname, ticker in COMPANY_NAME_MAP.items():
            if cname in text:
                mentioned.add(ticker)
                
    return sorted(list(mentioned))



@router.get("/discover/news-summary")
@limiter.limit("5/minute")
def get_news_summary(request: Request):
    """
    Returns an AI-synthesized summary of the top 10 market news headlines.
    Cache TTL: 4 hours (14400 seconds).
    """
    global _news_summary_cache
    
    current_time = time.time()
    ttl = 14400  # 4 hours
    
    if _news_summary_cache["data"] and current_time - _news_summary_cache["last_fetch"] < ttl:
        logger.info("News Summary: serving from cache")
        return _news_summary_cache["data"]
        
    logger.info("News Summary: cache miss or expired, generating new summary")
    
    # 1. Get raw news feed articles
    news_data = get_news(request)
    articles = news_data.get("articles", [])
    
    if not articles:
        return {
            "tldr": "No market news available to summarize at the moment.",
            "drivers": [],
            "metrics": [],
            "risks_catalysts": [],
            "sentiment": "NEUTRAL",
            "mentioned_tickers": [],
            "model_used": "none",
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
    # Extract mentioned tickers
    mentioned = _extract_mentioned_tickers(articles)
    
    # 2. Check settings and environment
    from src.config import settings
    from src.synthesis.llm import call_llm
    from src.cost_tracking.service import check_budget, log_cost
    import json
    import re
    
    # If in mock mode, return mock summary instantly
    if settings.llm_provider == "mock":
        mock_data = {
            "tldr": "Global stock markets capped off a record-breaking month fueled by relentless AI hardware demand and expanding health sector coverage. Momentum trades are achieving record gains despite warnings from strategists regarding bubble-like behavior in retail channels.",
            "drivers": [
                "AI-fueled momentum continues to act as the primary catalyst, pushing semiconductor and technology stocks to new high levels. This is driven by heavy institutional accumulation expecting structural demand to persist throughout 2026.",
                "Eli Lilly shares surged to record highs following the expansion of insurance coverage for its weight-loss drug Zepbound. The policy shifts significantly expand the addressable market, driving upward revisions in near-term revenue forecasts.",
                "Charles Schwab chief strategist warned of casino-like speculative behavior in retail channels. High retail options volume and leveraged momentum chasing could trigger volatility even as major indices log record closes."
            ],
            "metrics": [
                "Eli Lilly's stock reached all-time high valuation closes, cementing its position in the healthcare sector. This rally was directly supported by expanded commercial insurer lists.",
                "The Technology sector index registered a strong 1.5% weekly gain. This outperformance highlights persistent rotation away from defensive sectors into growth assets.",
                "Micron Technology hit new record highs ahead of its June 24 earnings release, reflecting intense pre-earnings accumulation by options dealers."
            ],
            "risks_catalysts": [
                "Overbought conditions in semiconductor leaders like Micron could trigger a profit-taking pullback. Technical momentum indexes are showing extreme levels, increasing risk for late-stage buyers.",
                "Charles Schwab's warnings highlight systemic risks of a retail-driven sentiment reversal. Option leverage at current multiples leaves the market vulnerable to sharp downside corrections if macro indicators change.",
                "Micron's upcoming quarterly financial release on June 24 represents a critical test of AI demand sustainability. Markets will closely monitor updates to cap-ex guidance and production volumes."
            ],
            "sentiment": "BULLISH",
            "mentioned_tickers": [
                {"ticker": "MU", "reason": "Mentioned due to hitting overbought levels following a massive weekly rally ahead of its June 24 report date."},
                {"ticker": "LLY", "reason": "Mentioned as its stock reached record highs driven by expanded insurance coverage for Zepbound."}
            ],
            "model_used": "local-mock",
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        _news_summary_cache["data"] = mock_data
        _news_summary_cache["last_fetch"] = current_time
        return mock_data
        
    # Enforce budget checks for paid LLMs
    if settings.llm_provider in ["bedrock", "openai", "anthropic"]:
        estimated_cost = 0.0006  # Slight buffer for larger summary prompt
        if not check_budget(estimated_cost):
            logger.warning("Skipping news summary AI call due to cost budget limits")
            return {
                "tldr": "AI News Summary is temporarily offline to preserve remaining token budget. Raw headlines are visible below.",
                "drivers": ["Budget Gated - summaries are temporarily paused."],
                "metrics": [],
                "risks_catalysts": [],
                "sentiment": "NEUTRAL",
                "mentioned_tickers": [{"ticker": t, "reason": "Mentioned in current news feed."} for t in mentioned],
                "model_used": "budget-fallback",
                "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

    # Format news items for prompt context
    news_lines = []
    for idx, art in enumerate(articles[:10]):
        title = art.get("title", "")
        desc = art.get("description", "")
        news_lines.append(f"[{idx+1}] Title: {title}\nDescription: {desc}")
    context_text = "\n\n".join(news_lines)
    
    prompt = (
        "You are an expert financial market analyst. Analyze the following 10 recent market news headlines and descriptions.\n\n"
        "Your task is to synthesize this information into a structured, executive-level summary.\n\n"
        "Generate a valid JSON object matching this structure exactly:\n"
        "{\n"
        '  "tldr": "A detailed 3-4 sentence paragraph providing a comprehensive overview of the current overarching narrative and market sentiment surrounding the stock markets or specific stocks based only on the retrieved articles.",\n'
        '  "drivers": [\n'
        '    "An extremely detailed explanation (3-4 sentences minimum) of a significant news event, product update, or macro factor driving momentum. You MUST explain the background context, WHY it is driving momentum, and the implications of this driver on the market. Do not use short bullet points or brief summaries. Detail the logical chain of cause and effect. You must generate EXACTLY 3 driver items in this array."\n'
        '  ],\n'
        '  "metrics": [\n'
        '    "An extremely detailed explanation (3-4 sentences minimum) of a specific financial number extracted from the articles (e.g., revenue growth, price targets, or valuation ratios). You MUST explain what this number means, what it implies for the company\'s valuation, its source, and the historical or market context surrounding it. You must generate EXACTLY 3 metric items in this array."\n'
        '  ],\n'
        '  "risks_catalysts": [\n'
        '    "An extremely detailed explanation (3-4 sentences minimum) of an upcoming event, regulatory hurdle, or competitor threat. You MUST explain the exact mechanism of how this risk or catalyst could affect near-term performance and why this represents a significant threat or opportunity. You must generate EXACTLY 3 risk/catalyst items in this array."\n'
        '  ],\n'
        '  "sentiment": "BULLISH" or "BEARISH" or "NEUTRAL",\n'
        '  "mentioned_tickers": [\n'
        '    {\n'
        '      "ticker": "TICKER_SYMBOL",\n'
        '      "reason": "A 1-sentence summary on why this specific stock is being mentioned in the news."\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "Rules:\n"
        "1. Do NOT summarize the articles one by one. You must cross-reference the information and synthesize the common themes.\n"
        "2. Ignore generic market commentary; focus strictly on actionable, company-specific information.\n"
        "3. If a specific metric or claim conflicts between articles, point out the discrepancy.\n"
        "4. Output ONLY the raw JSON object. Do not include markdown formatting or wrapping outside the JSON.\n"
        "5. The 'metrics', 'drivers', and 'risks_catalysts' fields MUST be simple arrays containing EXACTLY 3 detailed, multi-sentence paragraph strings (at least 3 sentences each) detailing the WHY and the background context. NEVER use short phrases or single-sentence bullet points.\n"
        f"6. The tickers found in the news are: {', '.join(mentioned) if mentioned else 'none'}. For each of these tickers, populate an entry in 'mentioned_tickers' with a 1-sentence reason why they are mentioned.\n\n"
        f"News Feed Context:\n{context_text}"
    )
    
    try:
        result = call_llm(prompt)
        text_out = result["text"]
        input_tokens = result["input_tokens"]
        output_tokens = result["output_tokens"]
        model_used = result["model_used"]
        
        # Log the cost
        log_cost("GLOBAL_NEWS", input_tokens, output_tokens)
        
        # Parse JSON output
        json_match = re.search(r'\{.*\}', text_out, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            summary_data = {
                "tldr": data.get("tldr", ""),
                "drivers": data.get("drivers", []),
                "metrics": data.get("metrics", []),
                "risks_catalysts": data.get("risks_catalysts", []),
                "sentiment": str(data.get("sentiment", "NEUTRAL")).upper().strip(),
                "mentioned_tickers": data.get("mentioned_tickers", []),
                "model_used": model_used,
                "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
        else:
            raise ValueError("No JSON block found in LLM response")
            
    except Exception as e:
        logger.error("Failed to generate AI news summary", error=str(e))
        summary_data = {
            "tldr": "Markets are showing active trading sessions across tech and healthcare segments with record index levels. Refer to raw headlines below for detail.",
            "drivers": ["Market volatility and sector shifting dominates context."],
            "metrics": [],
            "risks_catalysts": [],
            "sentiment": "NEUTRAL",
            "mentioned_tickers": [{"ticker": t, "reason": "Mentioned in raw news articles."} for t in mentioned],
            "model_used": "error-fallback",
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

    _news_summary_cache["data"] = summary_data
    _news_summary_cache["last_fetch"] = current_time
    return summary_data

