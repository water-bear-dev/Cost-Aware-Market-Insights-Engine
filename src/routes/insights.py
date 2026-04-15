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
