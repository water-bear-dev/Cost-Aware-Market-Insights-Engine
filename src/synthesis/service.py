from datetime import datetime
import structlog
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from src.clients.dynamo import get_table
from src.cost_tracking.service import check_budget, log_cost

logger = structlog.get_logger(__name__)

def synthesize_insights():
    logger.info("Starting AI insight synthesis (MOCK)")
    market_table = get_table('MarketData')
    insights_table = get_table('Insights')
    
    success_count = 0
    from src.config import settings
    
    for ticker in settings.ticker_list:
        try:
            response = market_table.query(
                KeyConditionExpression=Key('ticker').eq(ticker),
                ScanIndexForward=False,
                Limit=1
            )
            
            items = response.get('Items', [])
            if not items:
                logger.debug("No market data to synthesize", ticker=ticker)
                continue
                
            latest_data = items[0]
            
            insight_response = insights_table.query(
                KeyConditionExpression=Key('ticker').eq(ticker),
                ScanIndexForward=False,
                Limit=1
            )
            
            if insight_response.get('Items'):
                latest_insight = insight_response['Items'][0]
                if latest_insight.get('data_hash') == latest_data.get('data_hash'):
                    logger.debug("Insight already exists for latest data", ticker=ticker)
                    continue

        except Exception as e:
            logger.error("Failed to read market data for synthesis", ticker=ticker, error=str(e))
            continue
            
        estimated_cost = 0.000375
        if not check_budget(estimated_cost):
            logger.warning("Skipping synthesis due to budget", ticker=ticker)
            continue
            
        input_tokens = 900
        output_tokens = 85
        
        headlines = latest_data.get('headlines', [])
        headline_text = headlines[0] if headlines else 'No news'
        
        insight_text = (
            f"[MOCK INSIGHT] {ticker} closed at ${float(latest_data.get('close_price', 0)):.2f} "
            f"({float(latest_data.get('change_pct', 0)):.2f}%). "
            f"Top headline: '{headline_text}'. "
            "This is a mocked sentence replacing Bedrock's generation for local testing."
        )
        
        cost_record = log_cost(ticker, input_tokens, output_tokens)
        cost_to_record = cost_record['actual_cost_usd'] if cost_record else Decimal('0.0')
        
        timestamp = datetime.utcnow().isoformat() + "Z"
        ttl = int(datetime.utcnow().timestamp()) + (90 * 24 * 60 * 60)
        
        item = {
            'ticker': ticker,
            'timestamp': timestamp,
            'generated_at': timestamp,
            'insight_text': insight_text,
            'model_used': 'local-mock',
            'input_tokens': input_tokens,
            'output_tokens': output_tokens,
            'cost_usd': cost_to_record,
            'data_hash': latest_data.get('data_hash', ''),
            'ttl': ttl
        }
        
        try:
            insights_table.put_item(Item=item)
            success_count += 1
            logger.info("Saved new insight", ticker=ticker)
        except Exception as e:
            logger.error("Failed to save insight", ticker=ticker, error=str(e))
            
    logger.info("Synthesis complete", success_count=success_count)
    return success_count
