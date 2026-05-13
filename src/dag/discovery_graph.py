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
    metrics_str = json.dumps(state.get("metrics", {}), indent=2)
    research_str = json.dumps(state.get("research", {}), indent=2)
    news_str = json.dumps(state.get("news", {}), indent=2)
    
    # Select provider based on environment explicitly if not forced
    provider = settings.llm_provider
    if settings.environment == "production":
        provider = "bedrock"
    elif settings.environment == "local" and not provider:
        provider = "ollama"

    prompt = (
        f"You are a consensus committee of a Quantitative Analyst and a Fundamental Research Lead.\n\n"
        f"DATA SET 1: QUANT MODEL (Technicals/Risk):\n{metrics_str}\n\n"
        f"DATA SET 2: RESEARCH DEEP DIVE (Fundamentals/Analyst Targets):\n{research_str}\n\n"
        f"DATA SET 3: RECENT INTELLIGENCE (News):\n{news_str}\n\n"
        f"Identify exactly 3 picks with these STRICT categories:\n"
        f"1. Category: 'S&P 500' - Pick from: {state.get('sp500_universe', [])}\n"
        f"2. Category: 'Global Opportunity' - Pick from: {state.get('international_universe', [])}\n"
        f"3. Category: 'Hidden Gem' - Pick from: {state.get('hidden_gems_universe', [])}\n\n"
        f"For each pick, provide the following information:.\n\n"
        f"Explain exactly what the company (use the company name not the ticker) does and how it actually makes its money. Use plain English and absolutely no corporate jargon. .\n\n"
        f"Why is this stock a 'must-watch' right now? Why do customers choose them over the competition?.\n\n"
        f"The Health Check (The Numbers Translated): Provide a snapshot of their financials. Explain what the numbers mean in simple terms.\n\n"
        f"The 'Why Now' Signal (The Catalysts): What recent events, trends, or data points suggest this stock is poised to move in the near future?.\n\n"
        f"The Catch (Risks): List the top 2 realistic risks that could hurt this company (e.g., changing consumer habits, a specific new competitor). Keep the explanations simple.\n\n"
        f"The Bottom Line: A one-sentence summary of what kind of person might want to add this stock to their watchlist.\n\n"
        f"Output MUST be pure JSON matching this schema exactly:\n"
        f"[\n"
        f"  {{\"ticker\": \"...\", \"category\": \"S&P 500\", \"rationale\": \"...\"}},\n"
        f"  {{\"ticker\": \"...\", \"category\": \"Global Opportunity\", \"rationale\": \"...\"}},\n"
        f"  {{\"ticker\": \"...\", \"category\": \"Hidden Gem\", \"rationale\": \"...\"}}\n"
        f"]"
    )
    try:
        # --- AI Generation Loop with Retries ---
        recs = []
        max_attempts = 2
        for attempt in range(max_attempts):
            if recs: break
            try:
                if provider == 'ollama':
                    logger.info(f"Asking Ollama for recommendations (Attempt {attempt+1})", model=settings.ollama_model)
                    with httpx.Client(timeout=120.0) as client:
                        response = client.post(
                            f"{settings.ollama_url}/api/generate",
                            json={"model": settings.ollama_model, "prompt": prompt, "stream": False, "format": "json"}
                        )
                        response.raise_for_status()
                        text = response.json().get("response", "")
                else:
                    # Bedrock path
                    logger.info(f"Asking Bedrock for recommendations (Attempt {attempt+1})")
                    bedrock = boto3.client('bedrock-runtime', region_name=settings.aws_default_region)
                    body = {
                        "anthropic_version": "bedrock-2023-05-31",
                        "max_tokens": 1000,
                        "temperature": 0.4,
                        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
                    }
                    resp = bedrock.invoke_model(modelId="anthropic.claude-3-haiku-20240307-v1:0", body=json.dumps(body))
                    resp_body = json.loads(resp.get('body').read())
                    text = resp_body.get('content')[0].get('text', '')

                import re
                list_match = re.search(r'\[\s*\{.*\}\s*\]', text, re.DOTALL)
                if list_match:
                    recs = json.loads(list_match.group())
            except Exception as e:
                logger.error(f"AI Provider failed (Attempt {attempt+1})", provider=provider, error=str(e))

        # --- AI-First Result ---
        if not recs and state.get("metrics"):
            logger.warning("AI failed after all attempts. Falling back to progress state.")
            sp500_tickers = state.get("sp500_universe", [])
            intl_tickers = state.get("international_universe", [])
            gem_tickers = state.get("hidden_gems_universe", [])
            metrics = state.get("metrics", {})
            
            def get_best(tickers):
                valid = [t for t in tickers if t in metrics]
                if not valid: return None
                return max(valid, key=lambda t: metrics[t].get("momentum_1mo", -1))

            best_sp = get_best(sp500_tickers) or "SPY"
            best_intl = get_best(intl_tickers) or "BHP.AX"
            best_gem = get_best(gem_tickers) or "PLTR"
            
            recs = [
                {"ticker": best_sp, "category": "S&P 500", "rationale": "AI synthesis in progress..."},
                {"ticker": best_intl, "category": "Global Opportunity", "rationale": "AI synthesis in progress..."},
                {"ticker": best_gem, "category": "Hidden Gem", "rationale": "AI synthesis in progress..."}
            ]

        log_cost("DISCOVERY", 500, 200)
        return {"recommendations": recs}
        
    except Exception as e:
        logger.error("Discovery recommendation failed", error=str(e), provider=settings.llm_provider)
        return {"recommendations": []}

def save_recommendations_node(state: DiscoveryState) -> dict:
    recs = state.get("recommendations", [])
    if not recs: return {}
    
    insights_table = get_table('Insights')
    timestamp = datetime.utcnow().isoformat() + "Z"
    metrics = state.get("metrics", {})
    research_data = state.get("research", {})
    
    try:
        for rec in recs:
            if not isinstance(rec, dict) or 'category' not in rec or 'ticker' not in rec:
                continue

            t = rec['ticker']
            m = metrics.get(t, {})
            res = research_data.get(t, {})
            
            category_clean = rec['category'].replace(' ', '').replace('&', '').upper()
            ticker_id = f"_DAILY_{category_clean}_"
            final_price = m.get('last_price', 0.0)

            ticker_news = []
            try:
                t_obj = yf.Ticker(t)
                for n in t_obj.news[:3]:
                    ticker_news.append({
                        "title": n.get("title"),
                        "publisher": n.get("publisher"),
                        "link": n.get("link"),
                        "provider_publish_time": n.get("providerPublishTime")
                    })
            except: pass

            item = {
                'ticker': ticker_id,
                'timestamp': timestamp,
                'generated_at': timestamp,
                'insight_text': rec.get('rationale', ''),
                'signal': 'WATCH',
                'model_used': 'discovery-agent',
                'cost_usd': 0,
                'actual_ticker': t,
                'last_price': str(final_price),
                'change_5d':  str(m.get('change_5d', 0.0)),
                'momentum_1mo': str(round(m.get('momentum_1mo', 0.0) * 100, 2)),
                'volatility_ann': str(round(m.get('volatility_ann', 0.0) * 100, 2)),
                'dist_sma_200': str(round(m.get('dist_sma_200', 0.0) * 100, 2)),
                'rsi_14': str(round(m.get('rsi_14', 50), 2)),
                'exchange': res.get('sector', 'Unknown'), 
                'company_name': t,
                'currency': 'USD',
                'news': json.dumps(ticker_news)
            }
            insights_table.put_item(Item=item)
            logger.info("Saved research-backed daily pick", category=rec['category'], ticker=rec['ticker'])
    except Exception as e:
        logger.error("Failed saving daily recommendation", error=str(e))
        
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
