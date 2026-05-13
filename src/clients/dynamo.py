import boto3
from botocore.exceptions import ClientError
from src.config import settings
import structlog

logger = structlog.get_logger(__name__)

def get_dynamo_resource():
    return boto3.resource(
        'dynamodb',
        region_name=settings.aws_default_region,
        endpoint_url=settings.dynamodb_endpoint_url
    )

def init_tables():
    """Create tables locally if they don't exist."""
    dynamodb = get_dynamo_resource()
    
    try:
        tables = [t.name for t in dynamodb.tables.all()]
    except Exception as e:
        logger.error("Failed to connect to DynamoDB", error=str(e))
        return
        
    if "MarketData" not in tables:
        logger.info("Creating MarketData table")
        dynamodb.create_table(
            TableName="MarketData",
            KeySchema=[
                {'AttributeName': 'ticker', 'KeyType': 'HASH'},
                {'AttributeName': 'timestamp', 'KeyType': 'RANGE'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'ticker', 'AttributeType': 'S'},
                {'AttributeName': 'timestamp', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        
    if "Insights" not in tables:
        logger.info("Creating Insights table")
        dynamodb.create_table(
            TableName="Insights",
            KeySchema=[
                {'AttributeName': 'ticker', 'KeyType': 'HASH'},
                {'AttributeName': 'timestamp', 'KeyType': 'RANGE'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'ticker', 'AttributeType': 'S'},
                {'AttributeName': 'timestamp', 'AttributeType': 'S'},
                {'AttributeName': 'generated_at', 'AttributeType': 'S'}
            ],
            GlobalSecondaryIndexes=[
                {
                    'IndexName': 'latest-insight-index',
                    'KeySchema': [
                        {'AttributeName': 'ticker', 'KeyType': 'HASH'},
                        {'AttributeName': 'generated_at', 'KeyType': 'RANGE'}
                    ],
                    'Projection': {'ProjectionType': 'ALL'}
                }
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        
    if "CostTracking" not in tables:
        logger.info("Creating CostTracking table")
        dynamodb.create_table(
            TableName="CostTracking",
            KeySchema=[
                {'AttributeName': 'date', 'KeyType': 'HASH'},
                {'AttributeName': 'request_id', 'KeyType': 'RANGE'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'date', 'AttributeType': 'S'},
                {'AttributeName': 'request_id', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        
    if "Tickers" not in tables:
        logger.info("Creating Tickers table")
        dynamodb.create_table(
            TableName="Tickers",
            KeySchema=[
                {'AttributeName': 'ticker', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'ticker', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        
    if "QMJUniverse" not in tables:
        logger.info("Creating QMJUniverse table")
        dynamodb.create_table(
            TableName="QMJUniverse",
            KeySchema=[
                {'AttributeName': 'ticker', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'ticker', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )

    if "TrackedAssets" not in tables:
        logger.info("Creating TrackedAssets table")
        dynamodb.create_table(
            TableName="TrackedAssets",
            KeySchema=[
                {'AttributeName': 'ticker', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'ticker', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        
    if "SystemSettings" not in tables:

        logger.info("Creating SystemSettings table")
        dynamodb.create_table(
            TableName="SystemSettings",
            KeySchema=[
                {'AttributeName': 'setting_key', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'setting_key', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )

def get_table(table_name: str):
    return get_dynamo_resource().Table(table_name)
