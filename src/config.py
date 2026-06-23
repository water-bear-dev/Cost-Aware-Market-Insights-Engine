import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator

from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "local" # options: local, production
    aws_default_region: str = "us-east-1"
    dynamodb_endpoint_url: Optional[str] = None
    daily_budget_usd: float = 5.00
    log_level: Optional[str] = None  # auto: DEBUG in local, INFO in production
    llm_provider: Optional[str] = None # will be auto-detected if None
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.2"
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    anthropic_api_key: Optional[str] = None
    anthropic_model: str = "claude-3-5-haiku-20241022"
    enable_x_sentiment: bool = False
    x_bearer_token: Optional[str] = None
    x_api_base_url: str = "https://api.x.com"
    x_sentiment_max_results: int = 15
    tickers: str = "META,AAPL,AMZN,NFLX,GOOGL"
    enable_finops_limits: bool = False
    vibe_trading_mcp_url: str = "http://vibe-trading-mcp:8010/sse"
    
    @model_validator(mode='after')
    def detect_environment_networking(self) -> 'Settings':
        # 0. Determine default log level by environment unless explicitly set
        if not self.log_level:
            self.log_level = "DEBUG" if self.environment == "local" else "INFO"
        else:
            self.log_level = self.log_level.upper()

        # 1. Auto-detect LLM Provider
        if not self.llm_provider:
            if os.environ.get("AWS_EXECUTION_ENV") or self.environment == "production":
                self.llm_provider = "bedrock"
            elif os.environ.get("OPENAI_API_KEY") or self.openai_api_key:
                self.llm_provider = "openai"
            elif os.environ.get("ANTHROPIC_API_KEY") or self.anthropic_api_key:
                self.llm_provider = "anthropic"
            else:
                self.llm_provider = "ollama"
        
        # 2. Smart Networking: Fallback to localhost if running outside Docker
        # (Checks if we are in a container; if not, maps Docker hostnames to localhost)
        is_docker = os.path.exists('/.dockerenv')
        if not is_docker:
            if self.dynamodb_endpoint_url and "dynamodb-local" in self.dynamodb_endpoint_url:
                # Map internal 8000 to external 8001 (as per docker-compose.yml)
                self.dynamodb_endpoint_url = "http://localhost:8001"
            if self.ollama_url and "host.docker.internal" in self.ollama_url:
                self.ollama_url = "http://localhost:11434"
            if self.vibe_trading_mcp_url and "vibe-trading-mcp" in self.vibe_trading_mcp_url:
                self.vibe_trading_mcp_url = "http://localhost:8010/sse"
                
        return self
    
    @property
    def use_mock_ai(self) -> bool:
        return self.llm_provider == "mock"
    
    @property
    def ticker_list(self) -> list[str]:
        return [t.strip() for t in self.tickers.split(",") if t.strip()]

settings = Settings()
