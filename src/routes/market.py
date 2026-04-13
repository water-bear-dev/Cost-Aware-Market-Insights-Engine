from fastapi import APIRouter, HTTPException
from src.clients.dynamo import get_table

router = APIRouter()

@router.get("/market")
def get_market_data():
    table = get_table('MarketData')
    try:
        response = table.scan()
        latest = {}
        for item in response.get('Items', []):
            t = item['ticker']
            if t not in latest or item['timestamp'] > latest[t]['timestamp']:
                latest[t] = item
                
        # sanitize decimal for JSON serialization
        results = []
        for v in latest.values():
            results.append({
                "ticker": v["ticker"],
                "timestamp": v["timestamp"],
                "open_price": float(v["open_price"]),
                "high_price": float(v["high_price"]),
                "low_price": float(v["low_price"]),
                "close_price": float(v["close_price"]),
                "volume": int(v["volume"]),
                "change_pct": float(v["change_pct"]),
                "headlines": v.get("headlines", [])
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
