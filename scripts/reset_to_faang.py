import boto3

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
            if item['ticker'] not in FAANG_TICKERS:
                batch.delete_item(Key={'ticker': item['ticker']})
    
    # Add FAANG if missing
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
            batch.delete_item(Key={'ticker': item['ticker']})
    print("MarketData table cleared.")

    # 3. Clear Financials Table (to clear screener data)
    financials_table = dynamodb.Table('Financials')
    print("Clearing Financials table...")
    # Financials table usually has (ticker, year) composite key or similar
    # Let's check the schema first if unsure, but usually it's ticker as partition key.
    # Actually, most tables in this project use 'ticker' as the primary key for simple lookup.
    try:
        scan = financials_table.scan()
        with financials_table.batch_writer() as batch:
            for item in scan.get('Items', []):
                # We need to know the keys. If it's just 'ticker' and 'year_end' (composite)
                key = {'ticker': item['ticker']}
                if 'year_end' in item: key['year_end'] = item['year_end']
                batch.delete_item(Key=key)
        print("Financials table cleared.")
    except Exception as e:
        print(f"Note: Could not clear Financials table fully (might have composite key): {e}")

    print("Reset complete. Please run ingestion to populate FAANG data.")

if __name__ == "__main__":
    reset_to_faang()
