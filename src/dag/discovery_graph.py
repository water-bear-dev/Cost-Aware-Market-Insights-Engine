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
    hidden_gems_universe: List[str]
    metrics: Dict[str, dict]
    estimated_cost: float
    budget_cleared: bool
    recommendations: List[dict]
    universe: List[str] # Added to match main.py invoke
    messages: List[dict] # Added to match main.py invoke

def fetch_universe_node(state: DiscoveryState) -> dict:
    logger.info("Fetching universe")
    from src.ingestion.service import get_active_tickers
    
    active = set(get_active_tickers())
    
    # Top 10 S&P 500
    sp500_base = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "BRK-B", "LLY", "AVGO"]
    
    # 10 Volatile/Mid-cap hidden gems
    hidden_gems_base = ["PLTR", "SOFI", "RIVN", "UPST", "AFRM", "HOOD", "COIN", "DKNG", "ROKU", "PINS"]
    
    # Filter out tickers already being tracked
    active = {t.upper() for t in active}
    sp500 = [t for t in sp500_base if t.upper() not in active]
    hidden_gems = [t for t in hidden_gems_base if t.upper() not in active]
    
    logger.info("Filtered universe", active_count=len(active), sp500_remain=len(sp500), gems_remain=len(hidden_gems))
    
    return {"sp500_universe": sp500, "hidden_gems_universe": hidden_gems}

def quant_metrics_node(state: DiscoveryState) -> dict:
    logger.info("Calculating quant metrics")
    all_tickers = state.get("sp500_universe", []) + state.get("hidden_gems_universe", [])
    metrics = {}
    
    try:
        # Bulk download 1mo history
        data = yf.download(all_tickers, period="1mo", group_by="ticker", progress=False)
        for t in all_tickers:
            try:
                # Handle yfinance multi-level columns (Ticker, Attribute)
                if isinstance(data.columns, pd.MultiIndex):
                    if t not in data.columns.levels[0]: continue
                    hist = data[t]
                else:
                    # Single ticker, no MultiIndex (older yf or specific edge case)
                    hist = data
                
                if hist.empty: continue
                
                closes = hist['Close'].dropna()
                if len(closes) < 2: continue
                
                momentum = float((closes.iloc[-1] / closes.iloc[0]) - 1)
                volatility = float(closes.pct_change().std() * (252 ** 0.5))
                
                change_5d = float((closes.iloc[-1] / closes.iloc[-5]) - 1) if len(closes) >= 5 else momentum
                
                metrics[t] = {
                    "momentum_1mo": momentum,
                    "volatility_ann": volatility,
                    "last_price": float(closes.iloc[-1]),
                    "change_5d": change_5d
                }
            except Exception:
                continue
    except Exception as e:
        logger.error("Failed fetching quant metrics", error=str(e))
        
    logger.info("Calculated metrics", count=len(metrics))
    return {"metrics": metrics}

def finops_gate_node(state: DiscoveryState) -> dict:
    # Estimate cost for passing ~20 tickers to Claude
    estimated_cost = 0.0005 
    is_approved = check_budget(estimated_cost)
    return {"estimated_cost": estimated_cost, "budget_cleared": is_approved}

def bedrock_recommend_node(state: DiscoveryState) -> dict:
    if not state.get("budget_cleared", False):
        return {"recommendations": []}
        
    logger.info("Asking Bedrock for recommendations")
    metrics_str = json.dumps(state.get("metrics", {}), indent=2)
    
    prompt = (
        f"You are a professional market analyst writing for everyday investors. Review these quantitative metrics for 20 tickers:\n"
        f"{metrics_str}\n\n"
        f"Pick exactly 1 S&P 500 stock and exactly 1 Hidden Gem stock that look the most interesting today "
        f"based on a mix of momentum and volatility.\n\n"
        f"For the 'rationale', write 2-3 human-understandable sentences in plain English. "
        f"Explain what is happening with the price right now and why it stands out. Avoid jargon like 'standard deviation' or 'annualized volatility'. "
        f"Do NOT use bullet points. Write it as a single cohesive paragraph that sounds like a smart summary.\n\n"
        f"Output MUST be pure JSON matching this schema:\n"
        f"[\n"
        f"  {{\"ticker\": \"...\", \"category\": \"S&P 500\", \"rationale\": \"A 2-3 sentence narrative summary...\"}},\n"
        f"  {{\"ticker\": \"...\", \"category\": \"Hidden Gem\", \"rationale\": \"A 2-3 sentence narrative summary...\"}}\n"
        f"]"
    )
    
    try:
        if settings.llm_provider == 'mock':
            recs = [
                {"ticker": "NVDA", "category": "S&P 500", "rationale": "Strong momentum flag despite high market cap."},
                {"ticker": "PLTR", "category": "Hidden Gem", "rationale": "High volatility creates actionable trading bounds."}
            ]
        elif settings.llm_provider == 'ollama':
            logger.info("Asking Ollama for recommendations", model=settings.ollama_model)
            ollama_prompt = (
                f"Review these stock metrics:\n{metrics_str}\n\n"
                "Pick 1 'S&P 500' stock and 1 'Hidden Gem'. "
                "For 'rationale', write a 2-3 sentence paragraph explaining why you picked it. Use plain English. No bullets."
                "Output exactly this JSON format:\n"
                "[\n"
                "  {\"ticker\": \"...\", \"category\": \"S&P 500\", \"rationale\": \"...\"},\n"
                "  {\"ticker\": \"...\", \"category\": \"Hidden Gem\", \"rationale\": \"...\"}\n"
                "]"
            )
            try:
                with httpx.Client(timeout=120.0) as client:
                    response = client.post(
                        f"{settings.ollama_url}/api/generate",
                        json={
                            "model": settings.ollama_model,
                            "prompt": ollama_prompt,
                            "stream": False,
                            "format": "json"
                        }
                    )
                    response.raise_for_status()
                    data = response.json()
                    text = data.get("response", "")
                    logger.info("Ollama response text", text=text)
                    
                    # Robust JSON extraction
                    import re
                    recs = []
                    # 1. Try finding a list [...] first
                    list_match = re.search(r'\[\s*\{.*\}\s*\]', text, re.DOTALL)
                    if list_match:
                        try:
                            recs = json.loads(list_match.group())
                        except json.JSONDecodeError:
                            recs = []
                    
                    # 2. If no list, try finding an object {...}
                    if not recs:
                        obj_match = re.search(r'\{.*\}', text, re.DOTALL)
                        if obj_match:
                            try:
                                raw_obj = json.loads(obj_match.group())
                                # If it's a dict, convert to expected list format
                                if isinstance(raw_obj, dict):
                                    recs = []
                                    # Handle cases like {"S&P 500": {...}, "Hidden Gem": {...}}
                                    for cat in ["S&P 500", "Hidden Gem"]:
                                        val = raw_obj.get(cat)
                                        if isinstance(val, dict) and 'ticker' in val:
                                            recs.append({"ticker": val['ticker'], "category": cat, "rationale": val.get('rationale', '')})
                                        elif isinstance(val, str):
                                            recs.append({"ticker": val, "category": cat, "rationale": "High-interest asset surfaced by Discovery Agent."})
                                    
                                    # Handle cases like {"ticker": "AAPL", "category": "S&P 500", ...}
                                    if not recs and 'ticker' in raw_obj:
                                        recs = [raw_obj]
                            except:
                                recs = []
            except Exception as e:
                logger.error("Ollama connection failed", error=str(e))
                recs = []
        else:
            # Bedrock path
            try:
                logger.info("Asking Bedrock for recommendations")
                bedrock = boto3.client('bedrock-runtime', region_name=settings.aws_default_region)
                body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 500,
                    "temperature": 0.4,
                    "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
                }
                response = bedrock.invoke_model(
                    modelId="anthropic.claude-3-haiku-20240307-v1:0",
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body)
                )
                response_body = json.loads(response.get('body').read())
                text = response_body.get('content')[0].get('text', '')
                
                # Find JSON block
                import re
                list_match = re.search(r'\[\s*\{.*\}\s*\]', text, re.DOTALL)
                if list_match:
                    recs = json.loads(list_match.group())
                else:
                    logger.warning("Bedrock returned no JSON list", text=text)
                    recs = []
            except Exception as e:
                logger.error("Bedrock invocation failed", error=str(e))
                recs = []
                
        # --- Fallback Logic ---
        # If AI failed but we have metrics, pick the top momentum ones
        if not recs and state.get("metrics"):
            logger.info("Using fallback quant picks as AI failed")
            sp500_tickers = state.get("sp500_universe", [])
            gem_tickers = state.get("hidden_gems_universe", [])
            metrics = state.get("metrics", {})
            
            def get_best(tickers):
                valid = [t for t in tickers if t in metrics]
                if not valid: return None
                return max(valid, key=lambda t: metrics[t].get("momentum_1mo", -1))

            best_sp = get_best(sp500_tickers)
            best_gem = get_best(gem_tickers)
            
            if best_sp:
                recs.append({"ticker": best_sp, "category": "S&P 500", "rationale": "surfaced based on strong 1-month momentum signals."})
            if best_gem:
                recs.append({"ticker": best_gem, "category": "Hidden Gem", "rationale": "surfaced as a high-momentum volatile asset."})

        # Log cost
        log_cost("DISCOVERY", 500, 200)
        
        if not recs:
            logger.warning("Discovery agent generated empty recommendations")
            
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
    
    try:
        for rec in recs:
            # Defensive checks for malformed LLM output
            if not isinstance(rec, dict) or 'category' not in rec or 'ticker' not in rec:
                logger.warning("Skipping malformed recommendation record", record=rec)
                continue

            t = rec['ticker']
            m = metrics.get(t, {})
            
            # Fetch extra metadata for UI
            try:
                t_obj = yf.Ticker(t)
                info = t_obj.info
                exchange = info.get('exchange', '')
                company_name = info.get('longName') or info.get('shortName', '')
                
                # Robust price retrieval
                current_price = info.get('regularMarketPrice') or info.get('currentPrice') or info.get('previousClose')
                if not current_price and not m.get('last_price'):
                    # Last ditch effort from fast_info
                    try: current_price = t_obj.fast_info.get('lastPrice')
                    except: pass
                
                pre_market_price = info.get('preMarketPrice')
                pre_market_change = info.get('preMarketChangePercent')
                post_market_price = info.get('postMarketPrice')
                post_market_change = info.get('postMarketChangePercent')
                try:
                    currency = t_obj.fast_info.get('currency', 'USD')
                except:
                    currency = info.get('currency', 'USD')
            except Exception:
                exchange = ''
                company_name = ''
                currency = 'USD'
                current_price = None
                pre_market_price = None
                pre_market_change = None
                post_market_price = None
                post_market_change = None

            # We use a special ticker ID for easy fetching
            category_clean = rec['category'].replace(' ', '').replace('&', '').upper()
            ticker_id = f"_DAILY_{category_clean}_"
            # Final price selection
            final_price = current_price or m.get('last_price', 0.0)

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
                'exchange': exchange,
                'company_name': company_name,
                'currency': currency,
                'pre_market_price': str(pre_market_price) if pre_market_price else None,
                'pre_market_change': str(pre_market_change) if pre_market_change else None,
                'post_market_price': str(post_market_price) if post_market_price else None,
                'post_market_change': str(post_market_change) if post_market_change else None
            }
            insights_table.put_item(Item=item)
            logger.info("Saved daily recommendation", category=rec['category'], ticker=rec['ticker'])
    except Exception as e:
        logger.error("Failed saving daily recommendation", error=str(e))
        
    return {}

def build_discovery_graph():
    workflow = StateGraph(DiscoveryState)
    
    workflow.add_node("universe", fetch_universe_node)
    workflow.add_node("quant", quant_metrics_node)
    workflow.add_node("finops", finops_gate_node)
    workflow.add_node("bedrock", bedrock_recommend_node)
    workflow.add_node("save", save_recommendations_node)
    
    workflow.set_entry_point("universe")
    workflow.add_edge("universe", "quant")
    workflow.add_edge("quant", "finops")
    workflow.add_edge("finops", "bedrock")
    workflow.add_edge("bedrock", "save")
    workflow.add_edge("save", END)
    
    return workflow.compile()

discovery_dag = build_discovery_graph()
