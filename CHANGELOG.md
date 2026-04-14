# Changelog: Cost-Aware Market Insights Engine

All notable changes to this project will be documented in this file.

## [2.2.1] - 2026-04-14

### Fixed
- **Dark Mode CSS Recovery** — Restored the truncated `:root` block inside `style.css` which had temporarily stripped CSS variables and forced the UI into a stark white fallback mode. The interface is now locked back into the intended `#0f172a` minimal dark slate.
- **Auto-Recovery for PENDING Tickers** — Engineered a self-healing loop in the frontend. When `yfinance` downstream API rate-limits initial ticker additions, the trackers get stuck in a `pending_data` state. Instead of waiting 5 minutes for the background cron, `triggerBatchIngestion()` now automatically polls the new `POST /api/v1/tickers/{ticker}/ingest` endpoint stagger-style to seamlessly pull missing data as soon as the UI loads.

## [2.2.0] - 2026-04-14

### Added
- **API Rate Limiting** — Integrated `slowapi` to enforce request rate limits natively in FastAPI. `/api/v1/market` is limited to 20/minute to protect DynamoDB compute costs, while `/api/v1/tickers` mutations are capped at 5/minute to shelter the downstream Bedrock API and `yfinance` limits.
- **Native Chart Zooming** — Stripped out the flawed CSS-scaling pseudo-zoom toggles that skewed the underlying HTML grid layout. Leveraged `chartjs-plugin-zoom` to enable native X-axis mouse-wheel and pinch-to-zoom directly inside the borders of the Portfolio and Ticker Detail charts.
- **Invisible Ticker Fallbacks** — Refactored `/api/v1/market` to combine active DB `Tickers` alongside queried `MarketData`. Tickers added correctly but temporarily failing to parse downstream market results are now gracefully rendered into the UI as `pending_data`, allowing users to delete them and eliminating "Maximum 10 Allowed" soft blocks.


## [2.0.0] - 2026-04-13

### Added
- **AI Market Insights tab is now primary** — moved to first position in the tab navigation.
- **Delete Ticker** — `DELETE /api/v1/tickers/{ticker}` endpoint removes a ticker from the watchlist and cleans up its `MarketData` and `Insights` records. Frontend shows a smooth fade-out animation.
- **Rich News Links** — Headlines now include 2–5 clickable article links with source attribution, fetched from Google News RSS with a `yfinance` fallback.
- **AI Buy/Hold/Sell Signal** — Claude prompt updated to emit `SIGNAL: BUY|HOLD|SELL`. Signal is stored in `Insights` DynamoDB table and displayed as a colour-coded pill next to each ticker symbol. Data-driven fallback signal derived from price momentum when Bedrock is unavailable.
- **Expandable Ticker Modal** — Clicking any card opens a full-screen modal with: interactive time-series line chart, period selector (1D/1W/1M/1Y/5Y/MAX), key stats (52W high/low, P/E, market cap), analyst consensus bar chart (Strong Buy → Strong Sell), and full AI synthesis text.
- **Zoom Controls** — `+` / `−` / reset buttons scale the insights grid up to 1.6× or down to 0.5×.
- **Batch Synthesis Trigger** — On page load, any ticker missing an insight or with a stale one (>10 min) fires a `POST /api/v1/tickers/{ticker}/synthesize` in the background, ensuring all tickers are always analysed.
- **Analyst Data Endpoint** — `GET /api/v1/market/history/{ticker}?period=` returns OHLCV candles + analyst recommendation summary from `yfinance`.
- **On-demand Synthesis Endpoint** — `POST /api/v1/tickers/{ticker}/synthesize` triggers immediate AI synthesis for a single ticker bypassing the cron.

### Changed
- **Async Diff-Patch Rendering** — Background 15-second market polling no longer wipes and re-renders the DOM. Cards are updated in-place; only added/removed tickers trigger DOM mutations, eliminating all UI flicker.
- **Portfolio chart** — Bars are now green or red based on each ticker's daily change percentage.
- **Status badges** — Raw model ID strings replaced with human-readable status chips: 🟢 Live AI / 🟡 Data Insight / ⚪ Pending.
- **Ingestion service** — Upgraded from single-headline to rich `headline_links` list (`{title, url, source}`).
- **CSS design system** — New components: modal, signal pills, analyst bars, period buttons, zoom controls, stat grid, chart loading overlay.

---

---

## [2.1.0] - 2026-04-13

### Added
- **Centralized Ticker Management** — Removed delete buttons from individual cards to prevent accidental removal. Added a "Manage Watchlist" panel in the header for safe, centralized deletions.
- **Grid Density Controls** — Replaced global UI scaling (zoom) with a layout-aware grid density toggle:
    - **Compact**: 260px min-width cards for high-density overview.
    - **Standard**: 320px min-width (default).
    - **Wide**: Single-column focus mode for deep reading.
- **High-Contrast Links** — Upgraded news headlines to use a high-contrast cyan color (`#7dd3fc`) with underlines and improved hover states for better readability on dark backgrounds.

### Changed
- **Visual Rhythm** — Adjusted card paddings, font weights, and spacing for a more premium, cohesive feel.
- **Modal Close Logic** — Improved "Esc" and backdrop-click detection.

### Fixed
- **IAM Delete Permission** — Added `dynamodb:DeleteItem` permission to the ECS Task Role in `cloudformation.yml`, resolving a 500 Server Error that occurred when users attempted to delete tickers via the new Manage Watchlist panel.

---

## [2.0.1] - 2026-04-13

### Fixed
- **Batch Synthesis Coverage** — `triggerBatchSynthesis()` previously only targeted tickers with no insight or stale insights (>10 min). Tickers that had a `data-fallback` or `local-mock` insight were incorrectly treated as fully analysed and skipped. Updated the condition to also target any ticker whose `model_used` is not a real Claude model, ensuring every ticker receives genuine AI synthesis once Bedrock is confirmed healthy.
- **Staggered Synthesis Requests** — Batch synthesis requests are now staggered by 800ms per ticker to avoid hammering Bedrock concurrently, reducing the risk of throttling during mass re-analysis.

---

## [1.0.1-HOTFIX] - 2026-04-13

### Fixed
- **Bedrock IAM Permissions**: Added `aws-marketplace:ViewSubscriptions`, `aws-marketplace:Subscribe`, and `aws-marketplace:Unsubscribe` to the ECS Task Role in `cloudformation.yml`. Bedrock internally validates these marketplace permissions when invoking Anthropic models, even though the Model Access subscription page has been retired. Without them the `InvokeModel` call threw `AccessDeniedException` for every ticker, resulting in the "Awaiting AI Synthesis" state persisting indefinitely.
- **Synthesis Resilience Fallback**: Added graceful degradation in `synthesis/service.py` — if Bedrock returns an `AccessDeniedException`, the engine now generates a data-driven market summary from live price/headline data instead of silently returning `False`. The UI always shows meaningful content while IAM propagates.

### Verified
- **IAM Policy Confirmed Live**: Ran `check_iam.py` (boto3) against the real AWS role `market-insights-stack-EcsTaskRole-wV7qUFUhzNOJ` post-deploy. All 13 permissions confirmed active:
  - `aws-marketplace:Subscribe` ✓
  - `aws-marketplace:Unsubscribe` ✓
  - `aws-marketplace:ViewSubscriptions` ✓
  - `bedrock:InvokeModel` ✓
  - `bedrock:InvokeModelWithResponseStream` ✓
  - `cloudwatch:PutMetricData` ✓
  - `dynamodb:DescribeTable / GetItem / ListTables / PutItem / Query / Scan / UpdateItem` ✓
- **ECS Service Rollout Completed**: New task `c2b954b5967142fcb3cf896d22bc6d95` running with updated role. Bedrock synthesis expected on next 5-minute cron cycle.

---

## [1.0.0-PROD] - 2026-04-13

### Added
- **Dynamic Synthesis Fast-Path**: New `synthesize_single_insight` function allows for immediate AI generation when a user adds a ticker, bypassing the background cron delay for new assets.
- **Automated Service Refresh**: `scripts/deploy.sh` now automatically triggers an `aws ecs update-service --force-new-deployment` to ensure code changes are live immediately after push.
- **Project Conclusion**: Finalized the `DEVELOPMENT_BLOG.md` with operational summaries and architectural conclusions.

### Changed
- **UX Prioritization**: Swapped home screen defaults so **AI Market Insights** appears as the primary active tab, with the FinOps Dashboard moving to the secondary view.
- **Cost Metric Calibration**: Adjusted `estimated_cost` safety thresholds (from $0.000375 to $0.0002) to more accurately reflect Claude 3 Haiku real-world performance while maintaining budget safety.
- **Responsiveness Tuning**: Reduced the background synthesis interval from 15 minutes to **5 minutes**, providing a 3x increase in data freshness while staying within the $5.00/day budget.
- **Dynamic Synthesis Loop**: Refactored the synthesis service to pull live tickers from the DynamoDB `Tickers` table instead of relying on environment variables.
- **UI Consistency**: Updated the frontend `app.js` and `index.html` placeholders to reflect the new 5-minute performance metrics and active caching strategies.
- **Deployment UX**: Overhauled `scripts/deploy.sh` with cleaner logging and "Production-ready" console messaging.

### Fixed
- **Synthesis Gap**: Resolved an issue where new tickers added via the UI were not being picked up by the background AI synthesis loop.
- **Import Conflicts**: Fixed a function naming mismatch between the Ingestion and Synthesis services during dynamic handoffs.
