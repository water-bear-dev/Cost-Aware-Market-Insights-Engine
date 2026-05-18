import sys
import os
sys.path.append(os.getcwd())
from ingestion.service import ingest_market_data
print("Starting manual ingestion trigger...")
count = ingest_market_data()
print(f"Ingestion complete: {count} tickers updated.")
