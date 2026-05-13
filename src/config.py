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
    def detect_environment_networking(self) -> 'Settings':
        # 1. Auto-detect LLM Provider
        if not self.llm_provider:
            if os.environ.get("AWS_EXECUTION_ENV") or self.environment == "production":
                self.llm_provider = "bedrock"
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
                
        return self
    
    @property
    def use_mock_ai(self) -> bool:
        return self.llm_provider == "mock"
    
    @property
    def ticker_list(self) -> list[str]:
        return [t.strip() for t in self.tickers.split(",") if t.strip()]

settings = Settings()
