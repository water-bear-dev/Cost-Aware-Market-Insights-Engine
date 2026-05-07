from fastapi import APIRouter, Query, HTTPException, Request
from boto3.dynamodb.conditions import Key
from src.clients.dynamo import get_table
from src.ingestion.service import get_active_tickers
from src.limiter import limiter
from typing import Optional

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
                })
            return results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/daily_picks")
@limiter.limit("60/minute")
def get_daily_picks(request: Request):
    table = get_table('Insights')
    picks = []
    try:
        for ticker_id in ["_DAILY_SP500_", "_DAILY_HIDDENGEM_"]:
            resp = table.query(
                KeyConditionExpression=Key('ticker').eq(ticker_id),
                ScanIndexForward=False,
                Limit=1
            )
            rows = resp.get('Items', [])
            if rows:
                item = rows[0]
                picks.append({
                    "category": "S&P 500" if "SP500" in ticker_id else "Hidden Gem",
                    "actual_ticker": item.get("actual_ticker", "N/A"),
                    "rationale": item.get("insight_text", ""),
                    "timestamp": item.get("timestamp"),
                    "last_price": item.get("last_price", "0"),
                    "change_5d": item.get("change_5d", "0"),
                    "exchange": item.get("exchange", ""),
                    "company_name": item.get("company_name", ""),
                    "currency": item.get("currency", "USD")
                })
        return picks
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
