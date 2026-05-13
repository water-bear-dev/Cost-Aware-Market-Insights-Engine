import os
import json
import structlog
import yfinance as yf
import pandas as pd
from datetime import datetime

# Setup logging
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

# Import universes from seed_universes
from scripts.seed_universes import SP500_TICKERS, ASX200_TICKERS

def ingest_universe():
    """Ingest financials for the full S&P 500 and ASX 200 universes."""
    all_tickers = sorted(list(set(SP500_TICKERS + ASX200_TICKERS)))
    logger.info("Starting bulk ingestion", total_tickers=len(all_tickers))
    
    os.makedirs("scratch/bronze/financials", exist_ok=True)
    
    # Track progress to avoid re-fetching if we crash/stop
    already_ingested = {f.replace(".json", "") for f in os.listdir("scratch/bronze/financials") if f.endswith(".json")}
    to_ingest = [t for t in all_tickers if t not in already_ingested]
    
    logger.info("Filtering already ingested", already_ingested=len(already_ingested), remaining=len(to_ingest))
    
    # Parallel ingestion
    import concurrent.futures
    
    max_workers = 10
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_single_ticker, symbol): symbol for symbol in to_ingest}
        for future in concurrent.futures.as_completed(futures):
            symbol = futures[future]
            try:
                future.result()
            except Exception as e:
                logger.error("Future failed", ticker=symbol, error=str(e))
            
            # Check if we have enough
            current_count = len([f for f in os.listdir("scratch/bronze/financials") if f.endswith(".json")])
            if current_count >= 600:
                logger.info("Reached target count", count=current_count)
                # We can't easily break the executor, but we can stop submitting
                break

def fetch_single_ticker(symbol):
    try:
        ticker = yf.Ticker(symbol)
        
        # Fetch dataframes
        income_stmt = ticker.financials
        balance_sheet = ticker.balance_sheet
        cash_flow = ticker.cashflow
        
        if income_stmt.empty or balance_sheet.empty or cash_flow.empty:
            # Try quarterly as fallback
            income_stmt = ticker.quarterly_financials
            balance_sheet = ticker.quarterly_balance_sheet
            cash_flow = ticker.quarterly_cashflow
            
        if income_stmt.empty or balance_sheet.empty or cash_flow.empty:
            # logger.warning("Financial data missing for ticker", ticker=symbol)
            return
            
        info = ticker.info
        company_name = info.get('longName') or info.get('shortName') or symbol
        exchange = info.get('exchange', 'Unknown')
        industry = info.get('industry', 'Unknown')
        sector = info.get('sector', 'Unknown')
        market_cap = info.get('marketCap', 0)
        
        # Momentum
        momentum = 0
        try:
            hist = ticker.history(period="1y")
            if len(hist) > 20:
                start = hist['Close'].iloc[0]
                end = hist['Close'].iloc[-1]
                momentum = ((end - start) / start) * 100
        except:
            pass

        records = []
        dates = income_stmt.columns
        
        for date in dates:
            try:
                record = {
                    "ticker": symbol,
                    "company_name": company_name,
                    "exchange": exchange,
                    "industry": industry,
                    "sector": sector,
                    "market_cap": market_cap,
                    "momentum": momentum,
                    "report_date": date.isoformat() if hasattr(date, 'isoformat') else str(date),
                    "net_income": float(income_stmt.loc["Net Income", date]) if "Net Income" in income_stmt.index else None,
                    "gross_profit": float(income_stmt.loc["Gross Profit", date]) if "Gross Profit" in income_stmt.index else None,
                    "total_revenue": float(income_stmt.loc["Total Revenue", date]) if "Total Revenue" in income_stmt.index else None,
                    "total_assets": float(balance_sheet.loc["Total Assets", date]) if "Total Assets" in balance_sheet.index else None,
                    "total_equity": float(balance_sheet.loc["Stockholders Equity", date]) if "Stockholders Equity" in balance_sheet.index else (float(balance_sheet.loc["Total Equity", date]) if "Total Equity" in balance_sheet.index else None),
                    "total_debt": float(balance_sheet.loc["Total Debt", date]) if "Total Debt" in balance_sheet.index else None,
                    "operating_cash_flow": float(cash_flow.loc["Operating Cash Flow", date]) if "Operating Cash Flow" in cash_flow.index else None
                }
                records.append(record)
            except Exception:
                pass
        
        if records:
            file_path = f"scratch/bronze/financials/{symbol}.json"
            with open(file_path, "w") as f:
                json.dump(records, f, indent=2)
            # logger.info("Saved financials", ticker=symbol, count=len(records))

    except Exception as e:
        # logger.error("Failed to fetch financials", ticker=symbol, error=str(e))
        pass


if __name__ == "__main__":
    ingest_universe()
