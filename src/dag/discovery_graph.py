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

def fetch_universe_node(state: DiscoveryState) -> dict:
    logger.info("Fetching universe")
    from src.ingestion.service import get_active_tickers
    
    active = set(get_active_tickers())
    
    # Top 10 S&P 500
    sp500_base = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "BRK-B", "LLY", "AVGO"]
    
    # 10 Volatile/Mid-cap hidden gems
    hidden_gems_base = ["PLTR", "SOFI", "RIVN", "UPST", "AFRM", "HOOD", "COIN", "DKNG", "ROKU", "PINS"]
    
    # Filter out tickers already being tracked
    sp500 = [t for t in sp500_base if t not in active]
    hidden_gems = [t for t in hidden_gems_base if t not in active]
    
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
        f"You are a market analyst writing for everyday investors — not professionals. Review these quantitative metrics for 20 tickers:\n"
        f"{metrics_str}\n\n"
        f"Pick exactly 1 S&P 500 stock and exactly 1 Hidden Gem stock that look the most interesting today "
        f"based on a mix of momentum and volatility.\n\n"
        f"For the 'rationale', provide EXACTLY 3 bullet points using SIMPLE, PLAIN ENGLISH that any person could understand. "
        f"Use the actual numbers from the metrics in each point. Do NOT use jargon like 'annualized volatility' or 'standard deviation'.\n"
        f"Format: a bulleted list with each point on its own line starting with a dash (-)\n"
        f"  - What's Happening Right Now: Describe the recent price movement in plain terms with the actual % numbers. E.g. 'The stock climbed +12.4% over the last month, outpacing most of the market.'\n"
        f"  - Why It's Interesting: Explain in simple terms what makes this pick stand out based on the data. Be concrete and reference the numbers.\n"
        f"  - What to Watch For: Give one actionable observation — what signal or event the investor should keep an eye on.\n\n"
        f"Avoid technical jargon. Write like you're texting a smart friend. Keep each bullet to 1-2 sentences.\n"
        f"Output MUST be pure JSON matching this schema — the rationale field must be a list of 3 strings (one per bullet, WITHOUT the leading dash):\n"
        f"[\n"
        f"  {{\"ticker\": \"...\", \"category\": \"S&P 500\", \"rationale\": [\"bullet1\", \"bullet2\", \"bullet3\"]}},\n"
        f"  {{\"ticker\": \"...\", \"category\": \"Hidden Gem\", \"rationale\": [\"bullet1\", \"bullet2\", \"bullet3\"]}}\n"
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
            with httpx.Client(timeout=120.0) as client:
                response = client.post(
                    f"{settings.ollama_url}/api/generate",
                    json={
                        "model": settings.ollama_model,
                        "prompt": prompt,
                        "stream": False,
                        "format": "json"
                    }
                )
                response.raise_for_status()
                data = response.json()
                text = data.get("response", "")
                
                # Find JSON block
                start = text.find('[')
                end = text.rfind(']') + 1
                if start != -1 and end != 0:
                    recs = json.loads(text[start:end])
                else:
                    recs = []
        else:
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
            start = text.find('[')
            end = text.rfind(']') + 1
            if start != -1 and end != 0:
                recs = json.loads(text[start:end])
            else:
                recs = []
                
        # Log cost
        log_cost("DISCOVERY", 500, 200)
        
        return {"recommendations": recs}
        
    except Exception as e:
        logger.error("Bedrock recommendation failed", error=str(e))
        return {"recommendations": []}

def save_recommendations_node(state: DiscoveryState) -> dict:
    recs = state.get("recommendations", [])
    if not recs: return {}
    
    insights_table = get_table('Insights')
    timestamp = datetime.utcnow().isoformat() + "Z"
    metrics = state.get("metrics", {})
    
    try:
        for rec in recs:
            t = rec['ticker']
            m = metrics.get(t, {})
            
            # Fetch extra metadata for UI
            try:
                t_obj = yf.Ticker(t)
                info = t_obj.info
                exchange = info.get('exchange', '')
                company_name = info.get('longName') or info.get('shortName', '')
                try:
                    currency = t_obj.fast_info.get('currency', 'USD')
                except:
                    currency = info.get('currency', 'USD')
            except Exception:
                exchange = ''
                company_name = ''
                currency = 'USD'

            # We use a special ticker ID for easy fetching
            ticker_id = f"_DAILY_{rec['category'].replace(' ', '').replace('&', '').upper()}_"
            item = {
                'ticker': ticker_id,
                'timestamp': timestamp,
                'generated_at': timestamp,
                'insight_text': rec['rationale'],
                'signal': 'WATCH',
                'model_used': 'discovery-agent',
                'cost_usd': 0,
                'actual_ticker': t,
                'last_price': str(m.get('last_price', 0.0)),
                'change_5d':  str(m.get('change_5d', 0.0)),
                'momentum_1mo': str(round(m.get('momentum_1mo', 0.0) * 100, 2)),
                'volatility_ann': str(round(m.get('volatility_ann', 0.0) * 100, 2)),
                'exchange': exchange,
                'company_name': company_name,
                'currency': currency
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
