from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from src.clients.dynamo import get_table
from src.ingestion.service import get_active_tickers, force_ingest_single_ticker
from boto3.dynamodb.conditions import Key
import structlog
from src.limiter import limiter

router = APIRouter()
logger = structlog.get_logger(__name__)

class TickerRequest(BaseModel):
    ticker: str

@router.get("/tickers")
@limiter.limit("60/minute")
def get_tickers_route(request: Request):
    return get_active_tickers()

@router.post("/tickers")
@limiter.limit("15/minute")
def add_ticker(request: Request, req: TickerRequest):
    ticker = req.ticker.upper().strip()
    active = get_active_tickers()
    if ticker in active:
        raise HTTPException(status_code=400, detail="Ticker already tracked")
    
    if len(active) >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 tickers allowed")
        
    table = get_table('Tickers')
    try:
        table.put_item(Item={'ticker': ticker})
        
        # Force immediate ingestion so frontend sees data instantly
        success = force_ingest_single_ticker(ticker)
        if not success:
            raise HTTPException(status_code=400, detail=f"Failed to fetch market data for {ticker}")
            
        return {"status": "added", "ticker": ticker}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/tickers/{ticker}")
@limiter.limit("15/minute")
def delete_ticker(request: Request, ticker: str):
    """Remove a ticker from the watchlist and clean up its data."""
    ticker = ticker.upper().strip()
    
    try:
        # Remove from Tickers table
        tickers_table = get_table('Tickers')
        tickers_table.delete_item(Key={'ticker': ticker})
        
        # Clean up latest MarketData for this ticker
        try:
            market_table = get_table('MarketData')
            response = market_table.query(
                KeyConditionExpression=Key('ticker').eq(ticker)
            )
            for item in response.get('Items', []):
                market_table.delete_item(Key={'ticker': item['ticker'], 'timestamp': item['timestamp']})
        except Exception as e:
            logger.warning("Could not clean up MarketData", ticker=ticker, error=str(e))
        
        # Clean up Insights for this ticker
        try:
            insights_table = get_table('Insights')
            response = insights_table.query(
                KeyConditionExpression=Key('ticker').eq(ticker)
            )
            for item in response.get('Items', []):
                insights_table.delete_item(Key={'ticker': item['ticker'], 'timestamp': item['timestamp']})
        except Exception as e:
            logger.warning("Could not clean up Insights", ticker=ticker, error=str(e))
        
        logger.info("Ticker deleted", ticker=ticker)
        return {"status": "deleted", "ticker": ticker}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tickers/{ticker}/ingest")
@limiter.limit("30/minute")
def ingest_ticker_manually(request: Request, ticker: str):
    """Force market data fetching for a stalled or pending ticker."""
    ticker = ticker.upper().strip()
    success = force_ingest_single_ticker(ticker)
    if not success:
        raise HTTPException(status_code=400, detail=f"Failed to fetch market data for {ticker}")
    return {"status": "ingested", "ticker": ticker}

@router.post("/tickers/{ticker}/synthesize")
@limiter.limit("10/minute")
def synthesize_ticker(request: Request, ticker: str):
    """Trigger immediate AI synthesis for a specific ticker."""
    ticker = ticker.upper().strip()
    
    try:
        market_table = get_table('MarketData')
        response = market_table.query(
            KeyConditionExpression=Key('ticker').eq(ticker),
            ScanIndexForward=False,
            Limit=1
        )
        items = response.get('Items', [])
        if not items:
            raise HTTPException(status_code=404, detail=f"No market data found for {ticker}")
        
        from src.synthesis.service import synthesize_single_insight
        # Force synthesize by clearing data_hash temporarily
        item = dict(items[0])
        item['data_hash'] = ''  # bypass the dedup check
        result = synthesize_single_insight(item)
        
        return {"status": "synthesized" if result else "skipped", "ticker": ticker}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
