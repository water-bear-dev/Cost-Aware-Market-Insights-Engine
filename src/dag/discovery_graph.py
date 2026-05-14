from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Dict
import structlog
import yfinance as yf
from src.cost_tracking.service import check_budget, log_cost
import boto3
import json
import httpx
from src.config import settings
from datetime import datetime
from src.clients.dynamo import get_table
import pandas as pd

logger = structlog.get_logger(__name__)

class DiscoveryState(TypedDict):
    sp500_universe: List[str]
    international_universe: List[str]
    hidden_gems_universe: List[str]
    metrics: Dict[str, dict]
    research: Dict[str, dict]
    news: Dict[str, List[str]]
    estimated_cost: float
    budget_cleared: bool
    recommendations: List[dict]
    universe: List[str]
    messages: List[dict]

def fetch_universe_node(state: DiscoveryState) -> dict:
    # If universes already provided (e.g. from a targeted refresh), skip fetching new ones
    if state.get("sp500_universe") and state.get("international_universe") and state.get("hidden_gems_universe"):
        logger.info("Using pre-selected universe for targeted refresh")
        return {}

    logger.info("Fetching expanded universe for 12-hour discovery")
    from src.routes.discover import MOVERS_UNIVERSE
    from src.ingestion.service import get_active_tickers
    import random
    
    active = set(get_active_tickers())
    all_candidates = [t for t in MOVERS_UNIVERSE if t.upper() not in {a.upper() for a in active}]
    
    # Selection logic: Partition into 3 distinct pools
    sp500_candidates = [t for t in all_candidates if "." not in t]
    intl_candidates = [t for t in all_candidates if "." in t]
    
    # 1. S&P 500 (US Leaders)
    sp500 = random.sample(sp500_candidates, min(10, len(sp500_candidates)))
    
    # 2. Global Opportunities (Ex-US)
    intl = random.sample(intl_candidates, min(10, len(intl_candidates)))
    
    # 3. Hidden Gems (Everything else - mix of US and International)
    used = set(sp500 + intl)
    remaining = [t for t in all_candidates if t not in used]
    gems = random.sample(remaining, min(10, len(remaining)))
    
    logger.info("Global dynamic universe selected", sp500=len(sp500), international=len(intl), gems=len(gems))
    return {
        "sp500_universe": sp500, 
        "international_universe": intl, 
        "hidden_gems_universe": gems
    }

def quant_analyst_node(state: DiscoveryState) -> dict:
    """Implements 'quant-analyst' skill: Technicals & Risk."""
    logger.info("Running Quant Analyst modeling")
    all_tickers = state.get("sp500_universe", []) + state.get("international_universe", []) + state.get("hidden_gems_universe", [])
    metrics = {}
    
    try:
        # 1-year history for technicals (RSI, Moving Averages)
        data = yf.download(all_tickers, period="1y", group_by="ticker", progress=False)
        for t in all_tickers:
            try:
                if isinstance(data.columns, pd.MultiIndex):
                    if t not in data.columns.levels[0]: continue
                    hist = data[t]
                else:
                    hist = data
                
                if hist.empty: continue
                
                closes = hist['Close'].dropna()
                if len(closes) < 20: continue
                
                # Momentum & Vol
                momentum_1mo = float((closes.iloc[-1] / closes.iloc[-21]) - 1) if len(closes) >= 21 else 0
                volatility = float(closes.pct_change().std() * (252 ** 0.5))
                change_5d = float((closes.iloc[-1] / closes.iloc[-6]) - 1) if len(closes) >= 6 else momentum_1mo
                
                # Technicals
                sma_200 = closes.rolling(window=200).mean().iloc[-1]
                dist_200 = (closes.iloc[-1] / sma_200) - 1 if not pd.isna(sma_200) else 0
                
                # Simple RSI
                delta = closes.diff()
                gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
                rs = gain / loss
                rsi = 100 - (100 / (1 + rs.iloc[-1])) if not pd.isna(rs.iloc[-1]) else 50

                metrics[t] = {
                    "momentum_1mo": momentum_1mo,
                    "volatility_ann": volatility,
                    "last_price": float(closes.iloc[-1]),
                    "change_5d": change_5d,
                    "dist_sma_200": dist_200,
                    "rsi_14": rsi
                }
            except: continue
    except Exception as e:
        logger.error("Quant Analyst modeling failed", error=str(e))
        
    return {"metrics": metrics}

def xvary_research_node(state: DiscoveryState) -> dict:
    """Implements 'xvary-stock-research' skill: Fundamentals & Sentiment."""
    logger.info("Running xvary-stock-research deep dive")
    all_tickers = state.get("sp500_universe", []) + state.get("international_universe", []) + state.get("hidden_gems_universe", [])
    research = {}
    news_context = {}
    
    for t in all_tickers:
        try:
            t_obj = yf.Ticker(t)
            info = t_obj.info
            
            # Key quality/value factors
            research[t] = {
                "sector": info.get("sector"),
                "recommendation": info.get("recommendationKey"),
                "target_upside": (info.get("targetMeanPrice", 0) / info.get("currentPrice", 1)) - 1 if info.get("targetMeanPrice") else 0,
                "roe": info.get("returnOnEquity"),
                "rev_growth": info.get("revenueGrowth"),
                "pe_trailing": info.get("trailingPE"),
                "div_yield": info.get("dividendYield")
            }
            
            # Latest news
            headlines = [n.get('title') for n in t_obj.news[:3] if n.get('title')]
            if headlines:
                news_context[t] = headlines
                
        except: continue

    return {"research": research, "news": news_context}

def finops_gate_node(state: DiscoveryState) -> dict:
    # Estimate cost for passing ~20 tickers to Claude
    estimated_cost = 0.0005 
    is_approved = check_budget(estimated_cost)
    return {"estimated_cost": estimated_cost, "budget_cleared": is_approved}

def bedrock_recommend_node(state: DiscoveryState) -> dict:
    if not state.get("budget_cleared", False):
        return {"recommendations": []}
        
    logger.info("Asking AI for recommendations (Research + Quant Model)", environment=settings.environment)

    metrics = state.get("metrics", {})
    research = state.get("research", {})
    news = state.get("news", {})

    # Select provider based on environment explicitly if not forced
    provider = settings.llm_provider
    if settings.environment == "production":
        provider = "bedrock"
    elif settings.environment == "local" and not provider:
        provider = "ollama"

    # --- Step 1: Algorithm pre-selects the single best winner per category ---
    # The AI will NOT be asked to choose — it only writes the report.
    def get_best(tickers):
        valid = [t for t in tickers if t in metrics]
        if not valid:
            return None
        return max(valid, key=lambda t: metrics[t].get("momentum_1mo", -1))

    best_sp   = get_best(state.get("sp500_universe", []))        or "SPY"
    best_intl = get_best(state.get("international_universe", [])) or "BHP.AX"
    best_gem  = get_best(state.get("hidden_gems_universe", []))  or "PLTR"

    picks_to_analyse = [
        (best_sp,   "S&P 500"),
        (best_intl, "Global Opportunity"),
        (best_gem,  "Hidden Gem"),
    ]

    logger.info("Algorithm pre-selected winners", sp500=best_sp, intl=best_intl, gem=best_gem)

    # --- Step 2: Build a focused single-ticker research brief for each pick ---
    def build_focused_prompt(ticker, category):
        m = metrics.get(ticker, {})
        r = research.get(ticker, {})
        n_headlines = "; ".join(news.get(ticker, [])[:3])
        data_line = (
            f"RSI={m.get('rsi_14', '?'):.0f}, 1M-momentum={m.get('momentum_1mo', '?'):.1%}, "
            f"5D-change={m.get('change_5d', '?'):.1%}, dist-SMA200={m.get('dist_sma_200', '?'):.1%}, "
            f"annVol={m.get('volatility_ann', '?'):.1%}, "
            f"targetUpside={r.get('target_upside', '?'):.1%}, ROE={r.get('roe', '?')}, "
            f"revGrowth={r.get('rev_growth', '?')}, trailingPE={r.get('pe_trailing', '?')}, "
            f"divYield={r.get('div_yield', '?')}"
        ) if isinstance(m.get("rsi_14"), (int, float)) else "quantitative data limited"

        return (
            f"You are a senior equity research analyst writing an institutional-grade investment brief.\n\n"
            f"The stock selected for the '{category}' slot is: {ticker}\n\n"
            f"Quantitative data: {data_line}\n"
            f"Recent headlines: {n_headlines[:200] or 'No headlines available.'}\n\n"
            f"Write a detailed research report ONLY for {ticker}. "
            f"Do NOT mention or analyse any other company. "
            f"Do NOT choose a different stock — {ticker} is already selected.\n\n"
            f"INSTRUCTIONS — write 2-4 sentences minimum per field, analytical tone only:\n"
            f"  Why: Explain {ticker}'s core operations and primary revenue streams. "
            f"Describe their competitive advantage. Name 1-2 named competitors and what differentiates {ticker}.\n"
            f"  Numbers: Contextualised financial snapshot using the data above. "
            f"Comment on growth trajectory, margin trends, and balance sheet health.\n"
            f"  Catalysts: Exactly 2 specific, realistic factors that could drive {ticker} higher over 12-24 months.\n"
            f"  Risks: Exactly 2 specific risks that could pressure {ticker}. Name competitors or regulatory exposure.\n"
            f"  Bottom Line: One objective analytical sentence. State investor type (value/growth/income) and conditions.\n\n"
            f"Return ONLY a single valid JSON object, no markdown, no extra text:\n"
            f"{{\"ticker\": \"{ticker}\", \"category\": \"{category}\", \"rationale\": {{"
            f"\"Why\": \"<2-4 sentences>\", "
            f"\"Numbers\": \"<2-4 sentences>\", "
            f"\"Catalysts\": \"1. <specific>. 2. <specific>.\", "
            f"\"Risks\": \"1. <specific>. 2. <specific>.\", "
            f"\"Bottom Line\": \"<1 sentence>\"}}}}"
        )

    # --- Step 3: Fire one focused AI call per pick ---
    def call_ai(prompt, ticker, category):
        import re
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                if provider == "ollama":
                    logger.info(f"Ollama: analysing {ticker} (Attempt {attempt+1})", model=settings.ollama_model)
                    with httpx.Client(timeout=180.0) as client:
                        response = client.post(
                            f"{settings.ollama_url}/api/generate",
                            json={"model": settings.ollama_model, "prompt": prompt, "stream": False}
                        )
                        response.raise_for_status()
                        text = response.json().get("response", "")
                else:
                    logger.info(f"Bedrock: analysing {ticker} (Attempt {attempt+1})")
                    bedrock = boto3.client("bedrock-runtime", region_name=settings.aws_default_region)
                    body = {
                        "anthropic_version": "bedrock-2023-05-31",
                        "max_tokens": 800,
                        "temperature": 0.2,
                        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
                    }
                    resp = bedrock.invoke_model(modelId="anthropic.claude-3-haiku-20240307-v1:0", body=json.dumps(body))
                    resp_body = json.loads(resp.get("body").read())
                    text = resp_body.get("content")[0].get("text", "")

                logger.info(f"Raw AI response for {ticker} (first 200): {text[:200]}")

                # Parse the single JSON object
                obj_match = re.search(r'\{.*\}', text, re.DOTALL)
                if obj_match:
                    obj = json.loads(obj_match.group())
                    if isinstance(obj, dict):
                        # Force the ticker and category to what the algorithm chose — no drift
                        obj["ticker"] = ticker
                        obj["category"] = category
                        r = obj.get("rationale")
                        if isinstance(r, str):
                            try:
                                obj["rationale"] = json.loads(r)
                            except Exception:
                                pass
                        logger.info(f"Successfully parsed report for {ticker}", attempt=attempt + 1)
                        return obj

            except Exception as e:
                logger.error(f"AI call failed for {ticker} (Attempt {attempt+1})", error=str(e))

        # Per-ticker fallback if all AI attempts fail
        logger.warning(f"AI failed for {ticker} after all attempts. Using placeholder.")
        return {"ticker": ticker, "category": category, "rationale": "AI synthesis in progress..."}

    # Fire one focused request per pre-selected winner (sequential to avoid rate limits)
    recs = []
    for ticker, category in picks_to_analyse:
        prompt = build_focused_prompt(ticker, category)
        logger.info(f"Prompt size for {ticker}: {len(prompt)} chars / ~{len(prompt)//4} tokens", provider=provider)
        rec = call_ai(prompt, ticker, category)
        recs.append(rec)

    log_cost("DISCOVERY", 500, 200)
    return {"recommendations": recs}

def save_recommendations_node(state: DiscoveryState) -> dict:
    """Saves the final AI picks to DynamoDB with strict category mapping and metadata."""
    recs = state.get("recommendations", [])
    if not recs: return {}
    
    insights_table = get_table('Insights')
    timestamp = datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.utcnow().timestamp()) + (7 * 24 * 60 * 60) # 7 day retention

    # Strict slot mapping for the UI
    cat_to_id = {
        "S&P 500": "_DAILY_SP500_",
        "Global Opportunity": "_DAILY_GLOBALOPPORTUNITY_",
        "Hidden Gem": "_DAILY_HIDDENGEM_"
    }

    # Normalize category names from AI
    def normalize_cat(cat):
        c = (cat or "").upper()
        if "S&P" in c or "500" in c: return "S&P 500"
        if "GLOBAL" in c or "INT" in c or "OPP" in c: return "Global Opportunity"
        if "GEM" in c or "HIDDEN" in c: return "Hidden Gem"
        return "Hidden Gem" # Default fallback

    try:
        for rec in recs:
            ticker = rec.get("ticker", "").upper()
            if not ticker: continue
            
            raw_cat = rec.get("category", "Hidden Gem")
            norm_cat = normalize_cat(raw_cat)
            ticker_id = cat_to_id.get(norm_cat, "_DAILY_HIDDENGEM_")
            
            # Robust Metadata & Pricing Fetch
            try:
                t_obj = yf.Ticker(ticker)
                info = t_obj.info
                hist = t_obj.history(period="1d")
                
                close_price = 0.0
                if not hist.empty:
                    close_price = round(float(hist['Close'].iloc[-1]), 2)
                else:
                    close_price = info.get('previousClose', 0.0)

                ticker_news = []
                for n in t_obj.news[:3]:
                    # Support for new nested structure in recent yfinance versions
                    content = n.get("content") or {}
                    title = content.get("title") or n.get("title")
                    publisher = (content.get("provider") or {}).get("displayName") or n.get("publisher")
                    link = (content.get("clickThroughUrl") or {}).get("url") or n.get("link")
                    
                    if title:
                        ticker_news.append({
                            "title": title,
                            "publisher": publisher or "Market News",
                            "link": link or "#",
                            "provider_publish_time": content.get("pubDate") or n.get("providerPublishTime")
                        })

                raw_rationale = rec.get('rationale', '')

                # Normalize rationale to a clean dict before storing
                if isinstance(raw_rationale, list):
                    # AI returned a list — take the first element if it's a dict
                    raw_rationale = raw_rationale[0] if raw_rationale and isinstance(raw_rationale[0], dict) else {"Why": str(raw_rationale)}
                
                if isinstance(raw_rationale, str):
                    # Try to parse JSON string → dict
                    try:
                        parsed = json.loads(raw_rationale)
                        raw_rationale = parsed if isinstance(parsed, dict) else {"Why": raw_rationale}
                    except Exception:
                        # Plain text fallback — wrap in 'Why' key to preserve 2-column layout
                        raw_rationale = {"Why": raw_rationale} if raw_rationale else {"Why": "Analysis in progress..."}

                if not isinstance(raw_rationale, dict):
                    raw_rationale = {"Why": str(raw_rationale)}

                # Always serialize as JSON string for DynamoDB
                rationale_stored = json.dumps(raw_rationale)

                item = {
                    'ticker': ticker_id,
                    'timestamp': timestamp,
                    'generated_at': timestamp,
                    'rationale': rationale_stored,
                    'insight_text': rationale_stored,  # Legacy support
                    'signal': 'WATCH',
                    'model_used': 'discovery-agent',
                    'actual_ticker': ticker,
                    'last_price': str(close_price),
                    'exchange': info.get('exchange', 'Unknown'),
                    'company_name': info.get('longName') or info.get('shortName') or ticker,
                    'industry': info.get('industry') or info.get('sector') or 'Unknown',
                    'currency': info.get('currency', 'USD'),
                    'news': json.dumps(ticker_news),
                    'ttl': ttl
                }
                
                insights_table.put_item(Item=item)
                logger.info("Saved discovery pick", slot=ticker_id, ticker=ticker, currency=item['currency'])
                
            except Exception as meta_e:
                logger.error("Meta fetch failed for pick", ticker=ticker, error=str(meta_e))
                # Save basic version if meta fails
                item = {
                    'ticker': ticker_id,
                    'timestamp': timestamp,
                    'actual_ticker': ticker,
                    'rationale': rec.get('rationale', ''),
                    'company_name': ticker,
                    'last_price': "0.00",
                    'currency': 'USD',
                    'ttl': ttl
                }
                insights_table.put_item(Item=item)

    except Exception as e:
        logger.error("Failed saving recommendations", error=str(e))
        
    return {}

def build_discovery_graph():
    workflow = StateGraph(DiscoveryState)
    
    workflow.add_node("universe", fetch_universe_node)
    workflow.add_node("quant", quant_analyst_node)
    workflow.add_node("research", xvary_research_node)
    workflow.add_node("finops", finops_gate_node)
    workflow.add_node("bedrock", bedrock_recommend_node)
    workflow.add_node("save", save_recommendations_node)
    
    workflow.set_entry_point("universe")
    workflow.add_edge("universe", "quant")
    workflow.add_edge("quant", "research")
    workflow.add_edge("research", "finops")
    workflow.add_edge("finops", "bedrock")
    workflow.add_edge("bedrock", "save")
    workflow.add_edge("save", END)
    
    return workflow.compile()

discovery_dag = build_discovery_graph()
