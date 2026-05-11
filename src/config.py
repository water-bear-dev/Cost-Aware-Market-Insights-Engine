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
    llm_provider: Optional[str] = None # will be auto-detected if None
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.2"
    tickers: str = "META,AAPL,AMZN,NFLX,GOOGL"
    
    @model_validator(mode='after')
    def detect_provider(self) -> 'Settings':
        # Auto-detect if not explicitly set
        if not self.llm_provider:
            # Check for AWS execution environment first
            if os.environ.get("AWS_EXECUTION_ENV") or self.environment == "production":
                self.llm_provider = "bedrock"
            else:
                self.llm_provider = "ollama"
        return self
    
    @property
    def use_mock_ai(self) -> bool:
        return self.llm_provider == "mock"
    
    @property
    def ticker_list(self) -> list[str]:
        return [t.strip() for t in self.tickers.split(",") if t.strip()]

settings = Settings()
