from datetime import datetime
import uuid
from decimal import Decimal
import structlog
from src.config import settings
from src.clients.dynamo import get_table
from boto3.dynamodb.conditions import Key

logger = structlog.get_logger(__name__)

MOCK_INPUT_RATE = Decimal('0.00025') # per 1k tokens
MOCK_OUTPUT_RATE = Decimal('0.00125') # per 1k tokens

def get_today() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d')

def get_daily_spend() -> Decimal:
    """Calculates total spend for today from DynamoDB."""
    table = get_table('CostTracking')
    today = get_today()
    
    try:
        response = table.query(
            KeyConditionExpression=Key('date').eq(today)
        )
        total = Decimal('0.0')
        for item in response.get('Items', []):
            total += item.get('actual_cost_usd', Decimal('0.0'))
        return total
    except Exception as e:
        logger.error("Failed to fetch daily spend", error=str(e))
        return Decimal('0.0')

def check_budget(estimated_cost: float) -> bool:
    """Returns True if the estimated request fits within the daily budget."""
    daily_budget = Decimal(str(settings.daily_budget_usd))
    current_spend = get_daily_spend()
    estimated = Decimal(str(estimated_cost))
    
    if current_spend + estimated > daily_budget:
        logger.warning(
            "Budget exceeded", 
            current_spend=float(current_spend), 
            estimated=float(estimated), 
            budget=float(daily_budget)
        )
        return False
    return True

def log_cost(ticker: str, input_tokens: int, output_tokens: int) -> dict:
    table = get_table('CostTracking')
    today = get_today()
    req_id = str(uuid.uuid4())
    
    cost = (Decimal(input_tokens) / 1000 * MOCK_INPUT_RATE) + \
           (Decimal(output_tokens) / 1000 * MOCK_OUTPUT_RATE)
           
    item = {
        'date': today,
        'request_id': req_id,
        'ticker': ticker,
        'model': 'local-mock',
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'estimated_cost_usd': cost,
        'actual_cost_usd': cost,
        'timestamp': datetime.utcnow().isoformat() + "Z"
    }
    
    try:
        table.put_item(Item=item)
        logger.info("Cost logged", ticker=ticker, cost=float(cost))
        
        # Phase 3 FinOps: Emit CloudWatch Metrics
        from src.clients.cloudwatch import emit_metric
        from src.config import settings
        
        # We emit the delta cost so it can be 'Sum'med in CloudWatch Alarms over a 1-day period
        emit_metric('DailyAICost', float(cost), 'Count')
        
        # Calculate current utilization
        spend = get_daily_spend()
        budget = Decimal(str(settings.daily_budget_usd))
        utilization = float((spend / budget) * 100) if budget else 0.0
        emit_metric('BudgetUtilizationPct', utilization, 'Percent')
        
        return item
    except Exception as e:
        logger.error("Failed to log cost", ticker=ticker, error=str(e))
        return None
