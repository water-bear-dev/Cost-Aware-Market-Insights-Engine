import yfinance as yf
import json
import os
import structlog
from datetime import datetime, timedelta

logger = structlog.get_logger(__name__)

def fetch_financials_for_all():
    """Fetch financials for all tracked tickers and save to scratch/bronze/financials/."""
    from src.ingestion.service import get_active_tickers
    tickers = get_active_tickers()
    
    os.makedirs("scratch/bronze/financials", exist_ok=True)
    
    for symbol in tickers:
        try:
            logger.info("Fetching financials", ticker=symbol)
            ticker = yf.Ticker(symbol)
            
            # Fetch dataframes
            income_stmt = ticker.financials
            balance_sheet = ticker.balance_sheet
            cash_flow = ticker.cashflow
            
            if income_stmt.empty or balance_sheet.empty or cash_flow.empty:
                logger.warning("Financial data missing for ticker", ticker=symbol)
                continue
                
            # Fetch info for metadata
            info = ticker.info
            company_name = info.get('longName', symbol)
            exchange = info.get('exchange', 'Unknown')
            industry = info.get('industry', 'Unknown')
            sector = info.get('sector', 'Unknown')
            market_cap = info.get('marketCap', 0)
            
            # Momentum: 12-month return skipping last month (Asness et al standard)
            try:
                hist_2y = ticker.history(period="2y")
                if len(hist_2y) > 252: # at least 1 year of data
                    # end of month -13 to end of month -1
                    # 252 trading days in a year. 252 + 21 (1 month) = 273
                    if len(hist_2y) > 273:
                        start_price = hist_2y.iloc[-273]['Close']
                        end_price = hist_2y.iloc[-21]['Close']
                    else:
                        start_price = hist_2y.iloc[0]['Close']
                        end_price = hist_2y.iloc[-21]['Close']
                    momentum = ((end_price - start_price) / start_price) * 100
                else:
                    momentum = 0
            except:
                momentum = 0

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
                except Exception as e:
                    logger.warning("Failed to parse record for date", ticker=symbol, date=date, error=str(e))
            
            if records:
                file_path = f"scratch/bronze/financials/{symbol}.json"
                with open(file_path, "w") as f:
                    json.dump(records, f, indent=2)
                logger.info("Saved financials", ticker=symbol, count=len(records))
                
        except Exception as e:
            logger.error("Failed to fetch financials", ticker=symbol, error=str(e))

if __name__ == "__main__":
    fetch_financials_for_all()
