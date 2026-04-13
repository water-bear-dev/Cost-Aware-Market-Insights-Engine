from fastapi import APIRouter, Query, HTTPException
from boto3.dynamodb.conditions import Key
from src.clients.dynamo import get_table
from typing import Optional

router = APIRouter()

@router.get("/insights")
def get_insights(ticker: Optional[str] = None):
    table = get_table('Insights')
    
    try:
        if ticker:
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
            response = table.scan()
            latest = {}
            for item in response.get('Items', []):
                t = item['ticker']
                if t not in latest or item['timestamp'] > latest[t]['timestamp']:
                    latest[t] = item
            
            results = []
            for item in latest.values():
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
