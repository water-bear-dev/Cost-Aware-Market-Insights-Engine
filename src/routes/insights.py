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
            return items[0]
        else:
            response = table.scan()
            latest = {}
            for item in response.get('Items', []):
                t = item['ticker']
                if t not in latest or item['timestamp'] > latest[t]['timestamp']:
                    latest[t] = item
                    
            return list(latest.values())
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
