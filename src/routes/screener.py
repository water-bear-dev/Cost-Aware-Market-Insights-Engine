from fastapi import APIRouter
from src.clients.warehouse_client import warehouse_client

router = APIRouter(prefix="/api/v1/screener", tags=["screener"])

@router.get("/qmj")
def get_qmj_screener():
    try:
        results = warehouse_client.get_qmj_screener()
        return {"status": "success", "data": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}
