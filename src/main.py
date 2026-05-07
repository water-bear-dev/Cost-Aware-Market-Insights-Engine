from fastapi import FastAPI
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
import structlog
import os
import threading
import time
import pytz

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src.clients.dynamo import init_tables
from src.routes import health, insights, costs, tickers, market, v2_dag, meta
from src.ingestion.service import ingest_market_data
from src.synthesis.service import synthesize_insights
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from src.limiter import limiter

logger = structlog.get_logger(__name__)

scheduler = BackgroundScheduler()

def run_daily_discovery():
    logger.info("Triggering Daily Discovery Agent (8 AM AEST)")
    try:
        from src.dag.discovery_graph import discovery_dag
        # Run it asynchronously or synchronously (we'll just use a thread/loop if needed)
        # But APScheduler runs in its own thread, so we can run synchronous invoke here
        discovery_dag.invoke({"universe": [], "messages": []})
    except Exception as e:
        logger.error("Daily Discovery Failed", error=str(e), exc_info=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing app lifespan")
    # Initialize DynamoDB tables safely
    init_tables()

    # Schedule the discovery agent for 8:00 AM AEST
    aest_tz = pytz.timezone('Australia/Sydney')
    scheduler.add_job(
        run_daily_discovery, 
        'cron', 
        hour=8, 
        minute=0, 
        timezone=aest_tz
    )
    
    # Recurring Market Data Ingestion & Synthesis (every 5 mins)
    from datetime import datetime, timedelta
    scheduler.add_job(ingest_market_data, 'interval', minutes=5)
    scheduler.add_job(synthesize_insights, 'interval', minutes=5, next_run_time=datetime.now(pytz.utc) + timedelta(seconds=10))
    
    scheduler.start()

    # Startup: trigger it once on startup to ensure it populates immediately for the user
    def _ensure_daily_picks():
        from src.clients.dynamo import get_table
        from boto3.dynamodb.conditions import Key
        time.sleep(5) # Let uvicorn settle
        try:
            table = get_table('Insights')
            resp = table.query(
                KeyConditionExpression=Key('ticker').eq('_DAILY_SP500_'),
                Limit=1
            )
            if not resp.get('Items'):
                logger.info("No daily picks found. Running initial Discovery Agent cycle...")
                run_daily_discovery()
            else:
                logger.info("Daily picks already present in ledger.")
        except Exception as e:
            logger.error("Startup Discovery check failed", error=str(e))
        
    threading.Thread(target=_ensure_daily_picks, daemon=True).start()

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
app.include_router(v2_dag.router, prefix="/api/v2/tickers")
app.include_router(meta.router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
