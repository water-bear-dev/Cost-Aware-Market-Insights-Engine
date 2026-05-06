from datetime import datetime
import structlog
from decimal import Decimal
import json
import boto3
import httpx
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
            current_model = f"ollama-{settings.ollama_model}" if settings.llm_provider == "ollama" else settings.llm_provider
            
            # Skip only if both data AND model are the same
            if (latest_insight.get('data_hash') == latest_data.get('data_hash') and 
                latest_insight.get('model_used') == current_model):
                logger.debug("Insight already exists for latest data and model", ticker=ticker)
                return False
    except Exception as e:
        logger.error("Failed check for existing insight", ticker=ticker, error=str(e))

    # Only enforce budget for real paid cloud providers (Bedrock)
    if settings.llm_provider == "bedrock":
        estimated_cost = 0.0002  # Balanced Haiku estimation
        if not check_budget(estimated_cost):
            logger.warning("Skipping synthesis due to budget", ticker=ticker)
            return False
        
    headlines = latest_data.get('headlines', [])
    headline_links = latest_data.get('headline_links', [])
    # Build rich headline context (up to 5 articles)
    if isinstance(headline_links, list) and headline_links:
        news_items = []
        for h in headline_links[:5]:
            if isinstance(h, dict) and h.get('title'):
                src = f" ({h['source']}" + (f", {h['published'][:16]}" if h.get('published') else '') + ")" if h.get('source') else ""
                news_items.append(f"- {h['title']}{src}")
        headline_text = '\n'.join(news_items) if news_items else (headlines[0] if headlines else 'No recent news')
    elif headlines:
        headline_text = '\n'.join(f'- {h}' for h in headlines[:5])
    else:
        headline_text = 'No recent news available'
    change_pct = float(latest_data.get('change_pct', 0))
    
    if settings.llm_provider == "mock":
        input_tokens = 900
        output_tokens = 85
        signal = _derive_signal(change_pct)
        insight_text = (
            f"1. What's Happening: {ticker} moved {change_pct:.2f}% to end at ${float(latest_data.get('close_price', 0)):.2f}.\n"
            f"2. Why it Matters: The latest news about '{headline_text[:50]}...' is driving investor sentiment.\n"
            f"3. What to Watch: Keep an eye on how the market reacts to upcoming volume levels."
        )
        model_used = 'local-mock'
    elif settings.llm_provider == "ollama":
        try:
            prompt = (
                f"You are a helpful investment assistant. "
                f"Explain what's going on with {ticker} using the data and news provided.\n"
                f"1. What's Happening: (context)\n"
                f"2. Why it Matters: (outlook)\n"
                f"3. What to Watch: (next steps)\n"
                f"On the final line, output exactly: SIGNAL: BUY, SIGNAL: HOLD, or SIGNAL: SELL\n\n"
                f"Ticker: {ticker} | Close: ${float(latest_data.get('close_price', 0)):.2f} | Change: {change_pct:+.2f}%\n"
                f"News: {headline_text}"
            )
            
            resp = httpx.post(
                f"{settings.ollama_url}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3}
                },
                timeout=90.0
            )
            resp.raise_for_status()
            full_text = resp.json().get('response', '')
            
            # Simple parsing (Ollama doesn't give token counts easily in basic API)
            input_tokens = len(prompt) // 4
            output_tokens = len(full_text) // 4
            model_used = f"ollama-{settings.ollama_model}"
            
            signal = "HOLD"
            lines = full_text.strip().split('\n')
            insight_lines = []
            for line in lines:
                if "SIGNAL:" in line.upper():
                    for s in ["BUY", "SELL", "HOLD"]:
                        if s in line.upper(): signal = s
                else:
                    insight_lines.append(line)
            insight_text = '\n\n'.join(insight_lines).strip()
            
        except Exception as e:
            logger.error("Ollama invocation failed", error=str(e))
            return False
    else: # bedrock
        try:
            bedrock = boto3.client('bedrock-runtime', region_name=settings.aws_default_region)
            prompt = (
                f"You are a helpful investment assistant. "
                f"Explain what's going on with {ticker} in simple, user-friendly terms using the data and news provided.\n\n"
                f"Provide exactly 3 bullet points (no headers, no bold text):\n"
                f"1. What's Happening: Explain the latest price move or major news in simple terms.\n"
                f"2. Why it Matters: Explain how this affects the stock's outlook in plain English.\n"
                f"3. What to Watch: Identify one clear thing the user should keep an eye on next.\n\n"
                f"Be helpful, clear, and avoid jargon. Mention headlines naturally.\n"
                f"On the final line, output exactly: SIGNAL: BUY, SIGNAL: HOLD, or SIGNAL: SELL\n\n"
                f"Ticker: {ticker}\n"
                f"Close: ${float(latest_data.get('close_price', 0)):.2f} | Change: {change_pct:+.2f}%\n"
                f"Recent News Headlines:\n{headline_text}"
            )

            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "temperature": 0.3,
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
            
            # Parse signal and preserve structured paragraphs
            signal = "HOLD"
            lines = full_text.strip().split('\n')
            insight_lines = []
            for line in lines:
                stripped = line.strip()
                if not stripped: continue
                if stripped.upper().startswith("SIGNAL:"):
                    raw_signal = stripped.upper().replace("SIGNAL:", "").strip()
                    if raw_signal in ("BUY", "SELL", "HOLD"):
                        signal = raw_signal
                else:
                    insight_lines.append(line)
            insight_text = '\n\n'.join(insight_lines).strip()
            
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
