from pydantic import BaseModel
from typing import List

class MarketData(BaseModel):
    ticker: str
    timestamp: str
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: int
    change_pct: float
    headlines: List[str]
    data_hash: str
    ttl: int

class Insight(BaseModel):
    ticker: str
    timestamp: str
    insight_text: str
    model_used: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    data_hash: str
    generated_at: str
    ttl: int

class CostRecord(BaseModel):
    date: str
    request_id: str
    ticker: str
    model: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    actual_cost_usd: float
    timestamp: str
