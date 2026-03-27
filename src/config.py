from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    aws_default_region: str = "us-east-1"
    dynamodb_endpoint_url: str | None = None
    daily_budget_usd: float = 5.00
    use_mock_ai: bool = True
    tickers: str = "AAPL,MSFT,GOOGL,AMZN,META"
    
    @property
    def ticker_list(self) -> list[str]:
        return [t.strip() for t in self.tickers.split(",") if t.strip()]

settings = Settings()
