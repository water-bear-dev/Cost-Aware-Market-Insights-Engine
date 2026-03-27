from fastapi import APIRouter, HTTPException
from src.clients.dynamo import get_table
from src.cost_tracking.service import get_daily_spend, get_today
from src.config import settings

router = APIRouter()

@router.get("/costs")
def get_costs():
    try:
        spend = float(get_daily_spend())
        budget = settings.daily_budget_usd
        
        return {
            "date": get_today(),
            "daily_budget_usd": budget,
            "current_spend_usd": spend,
            "remaining_budget_usd": budget - spend,
            "utilization_pct": (spend / budget) * 100 if budget else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
