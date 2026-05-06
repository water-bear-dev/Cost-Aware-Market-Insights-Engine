from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    aws_default_region: str = "us-east-1"
    dynamodb_endpoint_url: str | None = None
    daily_budget_usd: float = 5.00
    llm_provider: str = "mock" # options: mock, bedrock, ollama
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3"
    tickers: str = "AAPL,MSFT,GOOGL,AMZN,META"
    
    @property
    def use_mock_ai(self) -> bool:
        return self.llm_provider == "mock"
    
    @property
    def ticker_list(self) -> list[str]:
        return [t.strip() for t in self.tickers.split(",") if t.strip()]

settings = Settings()
