import yfinance as yf
import json
import os
import structlog
import concurrent.futures
import subprocess
from datetime import datetime, timedelta

logger = structlog.get_logger(__name__)

def fetch_single_ticker(symbol):
    """Fetch and save financial data for a single ticker."""
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
            return False
            
        info = ticker.info
        company_name = info.get('longName') or info.get('shortName') or symbol
        exchange = info.get('exchange', 'Unknown')
        industry = info.get('industry', 'Unknown')
        sector = info.get('sector', 'Unknown')
        market_cap = info.get('marketCap', 0)
        
        # Momentum (12-mo skipping last month)
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
            return True
        return False

    except Exception as e:
        return False

def run_qmj_pipeline():
    """
    Executes the full QMJ Analytical Pipeline.

    This function performs a two-stage operation:
    1. Bulk Ingestion: Concurrently fetches financials for all tickers in the 
       'QMJUniverse' DynamoDB table.
    2. Analytical Transformation: Triggers a 'dbt run' to recalculate Z-scores, 
       percentiles, and composite QMJ rankings across the updated dataset.

    Intended for quarterly execution as part of the system's scheduled background jobs.
    """
    from src.clients.dynamo import get_table
    table = get_table('QMJUniverse')

    
    try:
        items = []
        scan_kwargs = {}
        while True:
            response = table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        tickers = [item['ticker'] for item in items]
    except Exception as e:
        logger.error("Failed to fetch QMJ universe", error=str(e))
        return

    logger.info("Starting QMJ Quarterly Pipeline", ticker_count=len(tickers))

    os.makedirs("scratch/bronze/financials", exist_ok=True)
    
    # 1. Bulk Ingestion (Parallel)
    success_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_single_ticker, s): s for s in tickers}
        for future in concurrent.futures.as_completed(futures):
            if future.result():
                success_count += 1
                
    logger.info("Bulk Ingestion complete", success=success_count, total=len(tickers))
    
    # 2. Run dbt
    try:
        logger.info("Running dbt transformation...")
        dbt_dir = os.path.join(os.getcwd(), "src", "dbt_qmj")
        # Run dbt via python module to ensure compatibility
        result = subprocess.run(
            ["python3", "-m", "dbt.cli.main", "run"],
            cwd=dbt_dir,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            logger.info("dbt run successful")
        else:
            logger.error("dbt run failed", error=result.stderr)
    except Exception as e:
        logger.error("Failed to run dbt pipeline", error=str(e))

if __name__ == "__main__":
    run_qmj_pipeline()
