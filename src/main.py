from fastapi import FastAPI
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
import structlog
import os
import threading
import time

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src.clients.dynamo import init_tables
from src.routes import health, insights, costs, tickers, market
from src.ingestion.service import ingest_market_data
from src.synthesis.service import synthesize_insights
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from src.limiter import limiter

logger = structlog.get_logger(__name__)

scheduler = BackgroundScheduler()

def scheduled_job():
    logger.info("Running scheduled ingestion and synthesis Job")
    try:
        if ingest_market_data() > 0:
            synthesize_insights()
    except Exception as e:
        logger.error("Job failed", error=str(e))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing app lifespan")
    # Initialize DynamoDB tables safely
    init_tables()

    # Run startup ingestion in background so the app becomes healthy immediately.
    # A 10-second delay lets the container settle and avoids hitting yfinance
    # from a cold AWS IP before all network routes are established.
    def _delayed_startup():
        time.sleep(10)
        logger.info("Running delayed startup ingestion")
        scheduled_job()

    threading.Thread(target=_delayed_startup, daemon=True).start()

    # Schedule to run every 5 minutes
    scheduler.add_job(scheduled_job, 'interval', minutes=5)
    scheduler.start()

    yield
    # Shutdown
    scheduler.shutdown()

app = FastAPI(title="AI Market Insights Engine", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# static files served at /static and / for dashboard
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_dashboard():
    return FileResponse("static/index.html")

app.include_router(health.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(costs.router, prefix="/api/v1")
app.include_router(tickers.router, prefix="/api/v1")
app.include_router(market.router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
