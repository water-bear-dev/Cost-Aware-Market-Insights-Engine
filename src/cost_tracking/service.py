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

def get_uptime_cost() -> Decimal:
    """Calculate $0.035/hr based on hours since midnight UTC."""
    now = datetime.utcnow()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hours = (now - midnight).total_seconds() / 3600
    return Decimal(str(hours * 0.035))

def get_budget_settings() -> dict:
    """Fetch budget settings from SystemSettings table."""
    table = get_table('SystemSettings')
    try:
        resp = table.get_item(Key={'setting_key': 'budget_config'})
        if 'Item' in resp:
            return resp['Item']
    except Exception:
        pass
    return {
        'daily_budget_usd': Decimal(str(settings.daily_budget_usd)),
        'budget_enabled': True
    }

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
    config = get_budget_settings()
    
    # If budget is disabled, always allow
    if not config.get('budget_enabled', True):
        return True
        
    daily_budget = config.get('daily_budget_usd', Decimal(str(settings.daily_budget_usd)))
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

def log_cost(ticker: str, input_tokens: int, output_tokens: int, model: str = None) -> dict:
    table = get_table('CostTracking')
    today = get_today()
    req_id = str(uuid.uuid4())
    
    model_name = model or f"{settings.llm_provider}-{settings.ollama_model if settings.llm_provider == 'ollama' else ''}"
    
    # Dynamic rate calculation (FinOps model pricing)
    input_rate = Decimal('0.0')
    output_rate = Decimal('0.0')
    
    if "openai" in model_name:
        input_rate = Decimal('0.00015')
        output_rate = Decimal('0.00060')
    elif "anthropic" in model_name:
        input_rate = Decimal('0.00080')
        output_rate = Decimal('0.00400')
    elif "bedrock" in model_name:
        input_rate = Decimal('0.00025')
        output_rate = Decimal('0.00125')
    elif "local-mock" in model_name:
        input_rate = MOCK_INPUT_RATE
        output_rate = MOCK_OUTPUT_RATE
        
    cost = (Decimal(input_tokens) / 1000 * input_rate) + \
           (Decimal(output_tokens) / 1000 * output_rate)
           
    item = {
        'date': today,
        'request_id': req_id,
        'ticker': ticker,
        'model': model_name,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'estimated_cost_usd': cost,
        'actual_cost_usd': cost,
        'timestamp': datetime.utcnow().isoformat() + "Z"
    }
    
    try:
        table.put_item(Item=item)
        logger.info("Cost logged", ticker=ticker, cost=float(cost), model=model_name)
        
        # Phase 3 FinOps: Emit CloudWatch Metrics
        from src.clients.cloudwatch import emit_metric
        
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

def record_cost(cost: Decimal, ticker: str = "SYSTEM", model: str = "system") -> dict:
    table = get_table('CostTracking')
    today = get_today()
    req_id = str(uuid.uuid4())
    
    item = {
        'date': today,
        'request_id': req_id,
        'ticker': ticker,
        'model': model,
        'input_tokens': 0,
        'output_tokens': 0,
        'estimated_cost_usd': cost,
        'actual_cost_usd': cost,
        'timestamp': datetime.utcnow().isoformat() + "Z"
    }
    
    try:
        table.put_item(Item=item)
        logger.info("Cost recorded via record_cost", cost=float(cost))
        
        from src.clients.cloudwatch import emit_metric
        emit_metric('DailyAICost', float(cost), 'Count')
        
        spend = get_daily_spend()
        budget = Decimal(str(settings.daily_budget_usd))
        utilization = float((spend / budget) * 100) if budget else 0.0
        emit_metric('BudgetUtilizationPct', utilization, 'Percent')
        
        return item
    except Exception as e:
        logger.error("Failed to record cost", error=str(e))
        return None
