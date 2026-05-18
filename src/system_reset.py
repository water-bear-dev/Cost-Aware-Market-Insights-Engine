import sys
import os
import time

# Ensure we can import from src
sys.path.append(os.getcwd())

import structlog
import pandas as pd
import yfinance as yf
from ingestion.service import force_ingest_single_ticker, get_active_tickers
from routes.market import _master_history_cache, _ticker_history_cache

logger = structlog.get_logger()

def purge_system():
    print("--- 1. Purging Server-Side Memory Caches ---")
    _master_history_cache.clear()
    _ticker_history_cache.clear()
    print(f"Caches cleared. Master: {len(_master_history_cache)}, Ticker: {len(_ticker_history_cache)}")

    print("\n--- 2. Forcing Fresh Ingestion for Australian Tickers ---")
    active_tickers = get_active_tickers()
    au_tickers = [t for t in active_tickers if t.endswith(".AX")]
    
    if not au_tickers:
        print("No Australian tickers (.AX) found in tracked list.")
    else:
        print(f"Found AU tickers: {au_tickers}")
        for t in au_tickers:
            print(f"Refreshing {t}...")
            success = force_ingest_single_ticker(t)
            print(f"Result for {t}: {'SUCCESS' if success else 'FAILED'}")

    print("\n--- 3. Verifying Backend Extraction Logic ---")
    try:
        # Fetch a small batch of AU tickers
        data = yf.download(au_tickers, period="5d", progress=False)
        for t in au_tickers:
            # We use the same extraction logic I just implemented in routes/market.py
            if isinstance(data.columns, pd.MultiIndex):
                try:
                    # Try the various ways it might be indexed
                    if t in data.columns.levels[0]:
                        series = data[t]['Close']
                    else:
                        series = data.xs(key=t, axis=1, level=1)['Close']
                    print(f"{t}: Extraction verified. Last Price: {series.iloc[-1]}")
                except Exception as e:
                    print(f"{t}: Extraction failed: {e}")
            else:
                print(f"{t}: Single index found. Last Price: {data['Close'].iloc[-1]}")
    except Exception as e:
        print(f"Verification failed: {e}")

if __name__ == "__main__":
    purge_system()
