from fastapi import APIRouter, Query, HTTPException, Request
from boto3.dynamodb.conditions import Key
from src.clients.dynamo import get_table
from src.ingestion.service import get_active_tickers
from src.limiter import limiter
from typing import Optional
import json

router = APIRouter()

@router.get("/insights")
@limiter.limit("60/minute")
def get_insights(request: Request, ticker: Optional[str] = None):
    table = get_table('Insights')

    try:
        if ticker:
            ticker = ticker.upper().strip()
            response = table.query(
                KeyConditionExpression=Key('ticker').eq(ticker),
                ScanIndexForward=False,
                Limit=1
            )
            items = response.get('Items', [])
            if not items:
                raise HTTPException(status_code=404, detail="Insight not found")
            item = items[0]
            return {
                "ticker": item["ticker"],
                "timestamp": item["timestamp"],
                "insight_text": item.get("insight_text", ""),
                "signal": item.get("signal", "HOLD"),
                "model_used": item.get("model_used", ""),
                "input_tokens": int(item.get("input_tokens", 0)),
                "output_tokens": int(item.get("output_tokens", 0)),
                "cost_usd": float(item.get("cost_usd", 0)),
                "sentiment_score": float(item.get("sentiment_score", 0.0)) if item.get("sentiment_score") is not None else 0.0,
                "sentiment_label": item.get("sentiment_label", "Neutral"),
                "social_volume": int(item.get("social_volume", 0)),
            }
        else:
            # Only return insights for actively tracked tickers (prevents ghost data)
            active_tickers = get_active_tickers()
            results = []
            for t in active_tickers:
                resp = table.query(
                    KeyConditionExpression=Key('ticker').eq(t),
                    ScanIndexForward=False,
                    Limit=1
                )
                rows = resp.get('Items', [])
                if not rows:
                    continue
                item = rows[0]
                results.append({
                    "ticker": item["ticker"],
                    "timestamp": item["timestamp"],
                    "insight_text": item.get("insight_text", ""),
                    "signal": item.get("signal", "HOLD"),
                    "model_used": item.get("model_used", ""),
                    "input_tokens": int(item.get("input_tokens", 0)),
                    "output_tokens": int(item.get("output_tokens", 0)),
                    "cost_usd": float(item.get("cost_usd", 0)),
                    "sentiment_score": float(item.get("sentiment_score", 0.0)) if item.get("sentiment_score") is not None else 0.0,
                    "sentiment_label": item.get("sentiment_label", "Neutral"),
                    "social_volume": int(item.get("social_volume", 0)),
                })
            return results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@ router.get("/daily_picks")
@limiter.limit("60/minute")
def get_daily_picks(request: Request):
    table = get_table('Insights')
    picks = []
    
    # All 3 Discovery Slots
    slots = ["_DAILY_SP500_", "_DAILY_GLOBALOPPORTUNITY_", "_DAILY_HIDDENGEM_"]
    
    # Strict Label Mapping (Corrected per user request)
    label_map = {
        "_DAILY_SP500_": "S&P 500",
        "_DAILY_GLOBALOPPORTUNITY_": "Global Opportunity",
        "_DAILY_HIDDENGEM_": "Hidden Gems"
    }
    
    try:
        for ticker_id in slots:
            resp = table.query(
                KeyConditionExpression=Key('ticker').eq(ticker_id),
                ScanIndexForward=False,
                Limit=1
            )
            rows = resp.get('Items', [])
            if rows:
                item = rows[0]
                # Use 'rationale' as primary, fallback to 'insight_text' for legacy
                raw_rationale = item.get("rationale") or item.get("insight_text", "Analysis in progress...")
                # Always try to parse it back to a dict (it may be stored as a JSON string)
                if isinstance(raw_rationale, str):
                    try:
                        raw_rationale = json.loads(raw_rationale)
                    except Exception:
                        pass  # Keep as string for legacy/fallback rendering
                
                picks.append({
                    "category": label_map.get(ticker_id, "Market Pick"),
                    "actual_ticker": item.get("actual_ticker", ticker_id.replace("_DAILY_", "").replace("_", " ")),
                    "rationale": raw_rationale,
                    "timestamp": item.get("timestamp"),
                    "last_price": item.get("last_price", "0"),
                    "exchange": item.get("exchange", "Unknown"),
                    "company_name": item.get("company_name", ""),
                    "industry": item.get("industry", "Unknown"),
                    "currency": item.get("currency", "USD"),
                    "news": item.get("news"),
                    "sentiment_score": float(item.get("sentiment_score", 0.0)) if item.get("sentiment_score") is not None else 0.0,
                    "sentiment_label": item.get("sentiment_label", "Neutral"),
                    "social_volume": int(item.get("social_volume", 0)),
                })
        return picks
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
