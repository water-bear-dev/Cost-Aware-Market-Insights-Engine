import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def chat_router_cases(fixtures_dir) -> list:
    with open(fixtures_dir / "chat_router_cases.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def swarm_success_payload(fixtures_dir) -> dict:
    with open(fixtures_dir / "swarm_payloads" / "success_aapl.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def swarm_missing_report_payload(fixtures_dir) -> dict:
    with open(fixtures_dir / "swarm_payloads" / "missing_report.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def mock_fallback_text(fixtures_dir) -> str:
    return (fixtures_dir / "swarm_payloads" / "mock_fallback.txt").read_text(encoding="utf-8").strip()


@pytest.fixture
def chat_app() -> FastAPI:
    """Minimal app with only the chat router (avoids DynamoDB / scheduler lifespan)."""
    from src.routes import chat

    app = FastAPI()
    app.include_router(chat.router, prefix="/api/v1")
    return app


@pytest.fixture
async def client(chat_app) -> AsyncClient:
    transport = ASGITransport(app=chat_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: live MCP/LLM groundedness eval (requires RUN_CHAT_EVAL=1)",
    )


def chat_eval_enabled() -> bool:
    return os.environ.get("RUN_CHAT_EVAL", "").strip() in ("1", "true", "True", "yes")
