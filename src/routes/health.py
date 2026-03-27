from fastapi import APIRouter
from src.clients.dynamo import get_dynamo_resource
import structlog

logger = structlog.get_logger(__name__)
router = APIRouter()

@router.get("/health")
def health_check():
    dynamo_status = "unhealthy"
    try:
        dynamo = get_dynamo_resource()
        # just list tables to verify connection
        list(dynamo.tables.limit(1))
        dynamo_status = "healthy"
    except Exception as e:
        logger.error("Health check dynamo failed", error=str(e))
        
    return {
        "status": "healthy" if dynamo_status == "healthy" else "unhealthy",
        "dynamodb": dynamo_status
    }
