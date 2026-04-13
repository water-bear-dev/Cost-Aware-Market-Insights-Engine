from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.clients.dynamo import get_table
from src.ingestion.service import get_active_tickers, force_ingest_single_ticker

router = APIRouter()

class TickerRequest(BaseModel):
    ticker: str

@router.get("/tickers")
def get_tickers_route():
    return get_active_tickers()

@router.post("/tickers")
def add_ticker(req: TickerRequest):
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
