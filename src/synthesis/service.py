from datetime import datetime
import structlog
from decimal import Decimal
import json
import boto3
from boto3.dynamodb.conditions import Key
from src.clients.dynamo import get_table
from src.cost_tracking.service import check_budget, log_cost

logger = structlog.get_logger(__name__)

def _derive_signal(change_pct: float) -> str:
    """Derive a simple data-driven signal when AI is unavailable."""
    if change_pct >= 2.0:
        return "BUY"
    elif change_pct <= -2.0:
        return "SELL"
    return "HOLD"

def synthesize_insights():
    logger.info("Starting AI insight synthesis")
    market_table = get_table('MarketData')
    
    success_count = 0
    from src.config import settings
    from src.ingestion.service import get_active_tickers
    
    active_tickers = get_active_tickers()
    for ticker in active_tickers:
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
            if synthesize_single_insight(latest_data):
                success_count += 1

        except Exception as e:
            logger.error("Failed in synthesis loop", ticker=ticker, error=str(e))
            continue
            
    logger.info("Synthesis complete", success_count=success_count)
    return success_count

def synthesize_single_insight(latest_data: dict) -> bool:
    """Synthesizes an insight for a specific market data item."""
    ticker = latest_data.get('ticker')
    insights_table = get_table('Insights')
    from src.config import settings
    
    try:
        # Check if insight already exists for this data hash
        insight_response = insights_table.query(
            KeyConditionExpression=Key('ticker').eq(ticker),
            ScanIndexForward=False,
            Limit=1
        )
        
        if insight_response.get('Items'):
            latest_insight = insight_response['Items'][0]
            if latest_insight.get('data_hash') == latest_data.get('data_hash'):
                logger.debug("Insight already exists for latest data", ticker=ticker)
                return False
    except Exception as e:
        logger.error("Failed check for existing insight", ticker=ticker, error=str(e))

    estimated_cost = 0.0002  # Balanced Haiku estimation
    if not check_budget(estimated_cost):
        logger.warning("Skipping synthesis due to budget", ticker=ticker)
        return False
        
    headlines = latest_data.get('headlines', [])
    headline_text = headlines[0] if headlines else 'No recent news'
    change_pct = float(latest_data.get('change_pct', 0))
    
    if getattr(settings, 'use_mock_ai', True):
        input_tokens = 900
        output_tokens = 85
        signal = _derive_signal(change_pct)
        insight_text = (
            f"[MOCK INSIGHT] {ticker} closed at ${float(latest_data.get('close_price', 0)):.2f} "
            f"({change_pct:.2f}%). "
            f"Top headline: '{headline_text}'. "
            "This is a mocked response (Cloud-compatible)."
        )
        model_used = 'local-mock'
    else:
        try:
            bedrock = boto3.client('bedrock-runtime', region_name=settings.aws_default_region)
            prompt = (
                f"Analyze the following stock data and headline. Write a concise 2-sentence market insight.\n"
                f"Then on a new line, output exactly one of: SIGNAL: BUY, SIGNAL: HOLD, or SIGNAL: SELL\n"
                f"Base the signal on price momentum, news sentiment and market context.\n\n"
                f"Ticker: {ticker}\n"
                f"Close: ${float(latest_data.get('close_price', 0)):.2f}\n"
                f"Change: {change_pct:.2f}%\n"
                f"Headline: {headline_text}"
            )
            
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 200,
                "messages": [
                    {"role": "user", "content": [{"type": "text", "text": prompt}]}
                ]
            }
            
            response = bedrock.invoke_model(
                modelId="anthropic.claude-3-haiku-20240307-v1:0",
                contentType="application/json",
                accept="application/json",
                body=json.dumps(body)
            )
            
            response_body = json.loads(response.get('body').read())
            full_text = response_body.get('content')[0].get('text', '')
            input_tokens = response_body.get('usage', {}).get('input_tokens', 0)
            output_tokens = response_body.get('usage', {}).get('output_tokens', 0)
            model_used = "anthropic.claude-3-haiku-20240307-v1:0"
            
            # Parse signal from last line
            signal = "HOLD"  # safe default
            lines = full_text.strip().split('\n')
            insight_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped.upper().startswith("SIGNAL:"):
                    raw_signal = stripped.upper().replace("SIGNAL:", "").strip()
                    if raw_signal in ("BUY", "SELL", "HOLD"):
                        signal = raw_signal
                else:
                    insight_lines.append(line)
            insight_text = '\n'.join(insight_lines).strip()
            
        except Exception as e:
            error_str = str(e)
            logger.error("Bedrock invocation failed", ticker=ticker, error=error_str)
            
            # Graceful fallback: AccessDeniedException → data-driven insight
            if "AccessDeniedException" in error_str or "aws-marketplace" in error_str:
                logger.warning(
                    "Bedrock model access not yet enabled. Falling back to data-driven insight.",
                    ticker=ticker
                )
                price = float(latest_data.get('close_price', 0))
                direction = "gained" if change_pct >= 0 else "lost"
                signal = _derive_signal(change_pct)
                insight_text = (
                    f"[Data Insight] {ticker} {direction} {abs(change_pct):.2f}% to ${price:.2f}. "
                    f"Market data is live — full AI synthesis activates once Bedrock model access is enabled. "
                    f"Top headline: '{headline_text}'."
                )
                input_tokens = 0
                output_tokens = 0
                model_used = "data-fallback"
            else:
                return False

    cost_record = log_cost(ticker, input_tokens, output_tokens)
    cost_to_record = cost_record['actual_cost_usd'] if cost_record else Decimal('0.0')
    
    timestamp = datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.utcnow().timestamp()) + (90 * 24 * 60 * 60)
    
    item = {
        'ticker': ticker,
        'timestamp': timestamp,
        'generated_at': timestamp,
        'insight_text': insight_text,
        'signal': signal,
        'model_used': model_used,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'cost_usd': cost_to_record,
        'data_hash': latest_data.get('data_hash', ''),
        'ttl': ttl
    }
    
    try:
        insights_table.put_item(Item=item)
        logger.info("Saved new insight", ticker=ticker, signal=signal)
        
        from src.clients.cloudwatch import emit_metric
        emit_metric('InsightsGenerated', 1.0, 'Count')
        return True
    except Exception as e:
        logger.error("Failed to save insight", ticker=ticker, error=str(e))
        return False
