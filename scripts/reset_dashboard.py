import boto3
import os

# Configuration
DYNAMODB_ENDPOINT = "http://localhost:8001"
REGION = "us-east-1"
FAANG_TICKERS = ["META", "AAPL", "AMZN", "NFLX", "GOOGL"]

def reset_to_faang():
    dynamodb = boto3.resource('dynamodb', endpoint_url=DYNAMODB_ENDPOINT, region_name=REGION)
    
    # 1. Reset Tickers Table
    tickers_table = dynamodb.Table('Tickers')
    print("Clearing Tickers table...")
    scan = tickers_table.scan()
    with tickers_table.batch_writer() as batch:
        for item in scan.get('Items', []):
            batch.delete_item(Key={'ticker': item['ticker']})
    
    # Add FAANG
    with tickers_table.batch_writer() as batch:
        for ticker in FAANG_TICKERS:
            batch.put_item(Item={'ticker': ticker})
    print(f"Tickers table reset to: {FAANG_TICKERS}")

    # 2. Clear MarketData Table (to clear dashboard)
    market_table = dynamodb.Table('MarketData')
    print("Clearing MarketData table...")
    scan = market_table.scan()
    with market_table.batch_writer() as batch:
        for item in scan.get('Items', []):
            # MarketData has (ticker, timestamp) composite key
            batch.delete_item(Key={
                'ticker': item['ticker'],
                'timestamp': item['timestamp']
            })
    print("MarketData table cleared.")

    print("Reset complete. Ingestion will now only process FAANG for the dashboard.")

if __name__ == "__main__":
    reset_to_faang()
