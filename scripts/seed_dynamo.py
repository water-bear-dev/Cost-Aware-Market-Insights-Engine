import boto3
import os
from scripts.seed_universes import SP500_TICKERS, ASX200_TICKERS

DYNAMODB_ENDPOINT = "http://localhost:8001"
REGION = "us-east-1"

def seed_dynamo():
    all_tickers = sorted(list(set(SP500_TICKERS + ASX200_TICKERS)))
    print(f"Seeding {len(all_tickers)} tickers into DynamoDB...")
    
    dynamodb = boto3.resource('dynamodb', endpoint_url=DYNAMODB_ENDPOINT, region_name=REGION)
    table = dynamodb.Table('Tickers')
    
    with table.batch_writer() as batch:
        for ticker in all_tickers:
            batch.put_item(Item={'ticker': ticker})
            
    print("Seeding complete.")

if __name__ == "__main__":
    seed_dynamo()
