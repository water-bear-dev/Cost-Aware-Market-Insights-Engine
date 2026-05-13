import boto3
import os
from scripts.seed_universes import SP500_TICKERS, ASX200_TICKERS

DYNAMODB_ENDPOINT = "http://dynamodb-local:8000"
REGION = "us-east-1"

def migrate():
    dynamodb = boto3.resource('dynamodb', endpoint_url=DYNAMODB_ENDPOINT, region_name=REGION)
    
    # 1. Migrate all 613 tickers to QMJUniverse
    all_tickers = sorted(list(set(SP500_TICKERS + ASX200_TICKERS)))
    print(f"Migrating {len(all_tickers)} tickers to QMJUniverse...")
    qmj_table = dynamodb.Table('QMJUniverse')
    with qmj_table.batch_writer() as batch:
        for ticker in all_tickers:
            batch.put_item(Item={'ticker': ticker})
            
    # 2. Migrate FAANG (hard limit 30) to TrackedAssets
    faang = ["AAPL", "MSFT", "GOOGL", "AMZN", "META"]
    print(f"Migrating {len(faang)} tickers to TrackedAssets...")
    tracked_table = dynamodb.Table('TrackedAssets')
    with tracked_table.batch_writer() as batch:
        for ticker in faang:
            batch.put_item(Item={'ticker': ticker})
            
    # 3. Clean up the old Tickers table (optional, but good for clarity)
    # For now we'll leave it or we can delete it. 
    # Let's just focus on the migration success.
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
