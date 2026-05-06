from fastapi import APIRouter, HTTPException
from src.clients.dynamo import get_table
from src.cost_tracking.service import get_daily_spend, get_today, get_uptime_cost
from src.config import settings
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key
import structlog

logger = structlog.get_logger(__name__)
router = APIRouter()

@router.get("/costs")
def get_costs():
    try:
        llm_spend = float(get_daily_spend())
        uptime_spend = float(get_uptime_cost())
        total_spend = llm_spend + uptime_spend
        budget = settings.daily_budget_usd
        
        return {
            "date": get_today(),
            "daily_budget_usd": budget,
            "current_spend_usd": total_spend,
            "llm_spend_usd": llm_spend,
            "infrastructure_spend_usd": uptime_spend,
            "remaining_budget_usd": budget - total_spend,
            "utilization_pct": (total_spend / budget) * 100 if budget else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/costs/dashboard")
def get_costs_dashboard():
    try:
        table = get_table('CostTracking')
        today = datetime.utcnow()
        history = []
        total_spent_7_days = 0.0
        
        for i in range(7):
            day_str = (today - timedelta(days=i)).strftime('%Y-%m-%d')
            response = table.query(KeyConditionExpression=Key('date').eq(day_str))
            
            day_total = sum(float(item.get('actual_cost_usd', 0)) for item in response.get('Items', []))
            history.append({
                "date": day_str,
                "spend_usd": day_total
            })
            total_spent_7_days += day_total
            
        daily_average = total_spent_7_days / 7
        projected_monthly = daily_average * 30
        
        return {
            "last_7_days": history,
            "metrics": {
                "total_7_days_usd": total_spent_7_days,
                "daily_average_usd": daily_average,
                "projected_30_days_usd": projected_monthly
            }
        }
    except Exception as e:
        logger.error("Dashboard cost aggregation failed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to aggregate dashboard metrics")
