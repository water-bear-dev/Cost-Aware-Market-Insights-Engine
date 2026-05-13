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
from src.routes import health, insights, costs, tickers, market, v2_dag, meta, discover, screener
from src.ingestion.service import ingest_market_data
from src.ingestion.financials import run_qmj_pipeline
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
        discovery_dag.invoke({"universe": [], "messages": []})
    except Exception as e:
        logger.error("Daily Discovery Failed", error=str(e), exc_info=True)

def refresh_discover_movers():
    """Refresh the movers cache daily (piggybacked on 8 AM AEST job)."""
    try:
        from src.routes.discover import _fetch_movers, _movers_cache
        import time
        _movers_cache["data"] = _fetch_movers()
        _movers_cache["last_fetch"] = time.time()
        logger.info("Movers cache refreshed")
    except Exception as e:
        logger.error("Movers refresh failed", error=str(e))

def refresh_discover_news():
    """Refresh the news cache hourly."""
    try:
        from src.routes.discover import _fetch_news, _news_cache
        import time
        _news_cache["data"] = _fetch_news()
        _news_cache["last_fetch"] = time.time()
        logger.info("News cache refreshed")
    except Exception as e:
        logger.error("News refresh failed", error=str(e))

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
        hour='8,20', 
        minute=0, 
        timezone=aest_tz
    )
    scheduler.add_job(
        refresh_discover_movers,
        'cron',
        hour='8,20',
        minute=1,
        timezone=aest_tz
    )
    # Hourly news refresh (at the top of every hour)
    scheduler.add_job(refresh_discover_news, 'cron', minute=0)

    # QMJ Analytical Pipeline (Quarterly: Jan 1, Apr 1, Jul 1, Oct 1 at 2 AM)
    scheduler.add_job(
        run_qmj_pipeline,
        'cron',
        month='1,4,7,10',
        day=1,
        hour=2,
        minute=0
    )
    
    # Recurring Market Data Ingestion & Synthesis (every 5 mins)

    from datetime import datetime, timedelta
    scheduler.add_job(ingest_market_data, 'interval', minutes=5)
    scheduler.add_job(synthesize_insights, 'interval', minutes=5, next_run_time=datetime.now(pytz.utc) + timedelta(seconds=10))
    
    scheduler.start()

    # Startup: trigger it once on startup to ensure it populates immediately for the user
    def _startup_tasks():
        from src.clients.dynamo import get_table
        from boto3.dynamodb.conditions import Key
        time.sleep(5) # Let uvicorn settle
        try:
            table = get_table('Insights')
            resp = table.query(
                KeyConditionExpression=Key('ticker').eq('_DAILY_SP500_'),
                Limit=1
            )
            items = resp.get('Items', [])
            should_refresh = False
            if not items:
                logger.info("No daily picks found. Initializing...")
                should_refresh = True
            else:
                # Check age
                from datetime import datetime
                last_ts = datetime.fromisoformat(items[0]['timestamp'].replace('Z', ''))
                age_hours = (datetime.utcnow() - last_ts).total_seconds() / 3600
                if age_hours > 12:
                    logger.info("Daily picks are stale (>12h). Refreshing...", age=round(age_hours, 1))
                    should_refresh = True
            
            if should_refresh:
                run_daily_discovery()
            else:
                logger.info("Daily picks are fresh.")
        except Exception as e:
            logger.error("Startup Discovery check failed", error=str(e))
        # Pre-warm all Discover caches so the tab is populated on first load
        try:
            from src.routes.discover import refresh_discover_caches
            refresh_discover_caches()
        except Exception as e:
            logger.error("Startup Discover pre-warm failed", error=str(e))
        
    threading.Thread(target=_startup_tasks, daemon=True).start()

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
app.include_router(discover.router, prefix="/api/v1")
app.include_router(screener.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
