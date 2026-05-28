# AI Market Insights Engine -- API Specification

## Base URL
`http://localhost:8000/api/v1`

## Ticker Management

### List Tracked Tickers
`GET /tickers`
- **Description**: Returns the list of tickers currently in the high-frequency watchlist (`TrackedAssets`).
- **Response**: `["AAPL", "MSFT", ...]`

### Add Ticker
`POST /tickers`
- **Description**: Adds a ticker to the `TrackedAssets` table.
- **Constraints**: Hard limit of 30 tickers.
- **Body**: `{"ticker": "NVDA"}`
- **Response**: `{"status": "added", "ticker": "NVDA"}`

### Delete Ticker
`DELETE /tickers/{ticker}`
- **Description**: Removes a ticker from the watchlist and purges its cached `MarketData` and `Insights`.

## Market Data & Insights

### Get Market Dashboard
`GET /market`
- **Description**: Returns real-time prices, 24h sparklines, and news headlines for all tracked assets.
- **Rate Limit**: 20 requests/minute.

### Get AI Insights
`GET /insights`
- **Description**: Returns the latest AI-synthesized investment theses for tracked assets.
- **Sentiment Fields**:
  - Backward-compatible: `sentiment_score`, `sentiment_label`, `social_volume`
  - Extended: `sentiment_sources`, `sentiment_divergence`, `sentiment_confidence`, `sentiment_errors`

### Trigger V2 DAG Synthesis
`POST /v2/dag/{ticker}/synthesize`
- **Description**: Triggers the LangGraph Alpha-DAG synthesis workflow for a specific ticker.
- **Response**: Includes FinOps gate result, generated insight, and sentiment diagnostics.

### Force Ticker Ingestion
`POST /tickers/{ticker}/ingest`
- **Description**: Bypasses the 5-minute cron and forces an immediate data fetch from Yahoo Finance.

## QMJ Quantitative Screener

### Get QMJ Rankings
`GET /screener/qmj`
- **Query Params**: `universe` (sp500|asx)
- **Description**: Returns the 5-factor QMJ scores and percentiles for the 600+ company universe.
- **Note**: Data is refreshed quarterly via the automated analytical pipeline.

## FinOps & Costs

### Get Cost Dashboard
`GET /costs/dashboard`
- **Description**: Returns 7-day rolling spend, daily averages, and 30-day projected run rates.

### Update Budget Settings
`POST /costs/settings`
- **Description**: Dynamically adjust the daily USD budget and enforcement status.
- **Body**: `{"daily_budget": 10.00, "enforce_budget": true}`
