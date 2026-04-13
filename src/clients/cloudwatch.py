import boto3
import structlog
from typing import Optional
from src.config import settings

logger = structlog.get_logger(__name__)

# Cache cloudwatch client
_cw_client = None

def get_cloudwatch_client():
    global _cw_client
    if _cw_client is None:
        try:
            _cw_client = boto3.client('cloudwatch', region_name=settings.aws_default_region)
        except Exception as e:
            logger.warning("Failed to initialize CloudWatch client (local dev?). Metrics will not be emitted.", error=str(e))
    return _cw_client


def emit_metric(name: str, value: float, unit: str = 'None', dimensions: Optional[list] = None) -> bool:
    """Safely emits a custom metric to CloudWatch under the MarketInsights namespace."""
    if dimensions is None:
        dimensions = []
        
    # Skip emission safely in full mock mode or if there is no client initialization, but log it locally.
    if getattr(settings, 'use_mock_ai', True):
        logger.info(f"[MOCK] Emitted Metric {name}", value=value, unit=unit)
        return True

    client = get_cloudwatch_client()
    if not client:
        return False

    try:
        client.put_metric_data(
            Namespace='MarketInsights',
            MetricData=[
                {
                    'MetricName': name,
                    'Value': float(value),
                    'Unit': unit,
                    'Dimensions': dimensions
                }
            ]
        )
        return True
    except Exception as e:
        logger.error("Failed to emit CloudWatch metric", metric=name, error=str(e))
        return False
