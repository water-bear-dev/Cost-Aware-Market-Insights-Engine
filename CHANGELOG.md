# Changelog: Cost-Aware Market Insights Engine

All notable changes to this project will be documented in this file.

## [2.9.2] - 2026-05-07

### Added
- **AI Transparency & Enriched Rationale** — Upgraded the Discovery Agent to provide more human-readable, metric-backed justifications for its daily picks. Recommendations now feature a 3-bullet "Smart Narrative" format:
  - **What's Happening** (Context)
  - **Why It's Interesting** (Potential)
  - **What to Watch** (Risks/Catalysts)
- **Granular Asset Metadata** — Surfaced quantitative performance metrics (`1-Month Momentum`, `5-Day Change`) directly on discovery pick cards for immediate data-driven validation.
- **Extended Hours Trading Data** — Integrated real-time Pre-Market and Post-Market price information (including % changes) across all ticker displays (Watchlist, Daily Picks, Top Movers, and Modal details).
- **Multi-Timeframe Asset Charts** — Added interactive period selectors (1D, 1W, 1M, 3M, 6M, 1Y) to each tracked asset card, enabling instant historical trend analysis directly from the dashboard.
- **Strict 4-Column Regional Layout** — Finalized the Global Markets section with a unified, 4-column single-row grid for AU, US, EU, and Asian indices.
- **Chronological News Feed** — Enforced a strict "newest-first" sorting logic for all news feeds across the application (Global Market News and Ticker-Specific headlines).
- **Enriched Discover Data** — 
  - **Commodities** now display standard trading units (e.g., `oz`, `bbl`, `kg`).
  - **Top Movers** now include the full company name alongside the ticker symbol for better readability.
  - **Market News** now includes short descriptions and improved visual alignment.

### Changed
- **Enriched Prompt Engineering** — Refined the LangGraph `discovery_graph.py` prompt to explicitly request 3-bullet JSON rationale outputs with specific focus areas, ensuring consistent high-quality AI synthesis.

## [2.9.1] - 2026-05-07

### Fixed
- **API Connectivity** — Resolved 404 errors for the new Discover endpoints by ensuring container restarts and proper router registration.
- **Portfolio Chart Restoration** — Fixed a data field mismatch (`sparkline` vs `sparkline_data`) that prevented the combined total chart from rendering.
- **Robust Data Handling** — Implemented a `clean_float` utility across all Market and Discover endpoints to prevent `NaN` values from causing JSON serialization failures (500 errors).
- **Filtering Stability** — Ensured that live card updates in the Manage tab correctly sync their data attributes, keeping filters and sorts accurate without requiring a page refresh.

## [2.9.0] - 2026-05-07

### Added
- **"Manage" Tab** — Renamed from "AI Market Insights". Now acts as the dedicated hub for managing your tracked assets.
- **"Discover" Tab** — Brand new section inserted after Manage, serving as a real-time global market briefing room:
  - **Regional Market Indices** — Live prices and % change for AU (ASX 200), US (S&P 500, Nasdaq), EU (Euro Stoxx 50), and Asia (Nikkei 225, Hang Seng).
  - **Commodities** — Live Gold, WTI Oil, and Silver prices.
  - **Top 10 Movers** — Side-by-side tables of the day's biggest gainers and losers, refreshed daily at 8:00 AM AEST.
  - **Top News** — 10 most recent market headlines, refreshed every hour on the clock.
  - **Daily Discovery Picks** — Moved here from the Manage tab.
- **Portfolio Area Chart** — Replaced the static bar chart with a time-series area chart showing the combined total value of all tracked assets over the last 24 hours, updated whenever assets are added or removed.
- **Asset Search, Filter & Sort** — New control row in the Manage tab:
  - Full-text search filtering by ticker symbol or company name.
  - Filter by country and exchange (ASX, Nasdaq, NYSE, etc.).
  - Sort by name, price (ascending/descending), and % change (ascending/descending).
- **Force Refresh on Empty Data** — All Discover endpoints and the startup sequence now detect empty caches and trigger an immediate live fetch before returning, ensuring data is always available from the very first page load.
- **New Backend Endpoint** — `GET /api/v1/discover/indices`, `GET /api/v1/discover/movers`, `GET /api/v1/discover/news` via new `src/routes/discover.py`.

### Changed
- **Navigation Order** — Tabs reorganised to: `Manage | Discover | ··· | Costs | How it Works`. Costs and How it Works pushed to the far right.
- **"Tracked Tickers"** renamed to **"Tracked Assets"** throughout the UI.
- **Daily Discovery Picks** relocated from the Manage tab to the new Discover section.

## [2.8.3] - 2026-05-07
### Added
- **24-Hour Value Timelines** — Integrated sparkline charts directly into ticker cards. These provide a rolling 24-hour visual history of price action at 15-minute intervals, providing immediate context on intraday momentum.
- **Expanded Portfolio Capacity** — Increased the tracked ticker limit from 10 to 30, allowing for more comprehensive market monitoring without performance degradation.
- **Enhanced Data Visualization** — Added static numeric labels above all bars in the portfolio summary chart for instant legibility. Disabled interactive zoom to prevent accidental layout shifts.

### Changed
- **Smart Sparkline Placement** — Dynamically repositioned the sparkline container based on view density: placed between ticker and price in "Horizontal" mode, and below the company name in "Wide/Standard" modes.
- **Professional Metadata** — Ticker cards now feature high-contrast exchange labels (e.g., NASDAQ, NYSE) at the top of every card for enterprise-grade scannability.

## [2.8.1] - 2026-05-07
### Added
- **Multi-Currency Support** — Integrated a real-time currency selector (USD, EUR, GBP, AUD, JPY) that instantly converts all prices, budget metrics, and chart axes across the entire dashboard.
- **Interactive Portfolio Chart** — Tickers in the main portfolio graph are now clickable, allowing users to jump directly to a deep-dive modal from the visualization.
- **Zero-Flicker Updates** — Disabled chart refresh animations for background data updates, ensuring a smoother, non-distracting user experience during market shifts.
- **Interactive 'How it Works' Tab** — Added a dedicated education section outlining the engine's FinOps-first architecture with animated system infrastructure.
- **Daily Discovery AI Polish** — Enhanced discovery picks to include formatted AI analysis and seamless modal expansion.

### Changed
- **UI Consolidation** — Renamed "FinOps Dashboard" to "Costs" for a cleaner, more focused interface.
- **Progressive Insight Disclosure** — Re-enabled first-paragraph truncation on home cards to maintain high information density while providing "Click to expand" guidance.

## [2.8.0-alpha] - 2026-05-06
### Added
- **LangGraph Alpha-DAG Orchestration** — Transitioned from a monolithic APScheduler background job to a Directed Acyclic Graph (DAG) state machine using LangGraph. This orchestrates all AI synthesis tasks and safely manages conversational state memory.
- **Model Context Protocol (MCP) Sandboxes** — Decoupled execution environments to adhere to strict security constraints. Created `Market Data MCP` (yfinance proxy) and a dockerized, network-restricted `Quant Compute MCP` for isolated Pandas/Math execution.
- **FinOps Interceptor Node** — Integrated a pre-flight LangGraph node that estimates generation costs and physical halts the DAG if the DynamoDB-backed `$5.00` daily budget is breached.
- **V2 Shadow Deployment Endpoint** — Exposed `POST /api/v2/tickers/{ticker}/synthesize` allowing the new distributed architecture to be tested in parallel without disrupting the `v1` dashboard.
    
## [2.7.0] - 2026-05-04
### Added
- **Ticker Autocomplete** — Implemented a real-time, debounced search mechanism for the "Track Ticker" input. The UI now queries Yahoo Finance to suggest symbols and their corresponding trading platforms (e.g., `NASDAQ: AAPL`).
- **Exchange Prefix Stripping** — Engineered a smart submission handler that allows users to select tickers with exchange prefixes (e.g., `NASDAQ: AAPL`) while automatically stripping the prefix before sending to the backend, ensuring seamless `yfinance` compatibility.
- **AWS Teardown Automation** — Introduced `scripts/teardown.sh`, a dedicated utility script to safely purge CloudFormation stacks and ECR repositories. This allows users to exit AWS deployments and return to a local-only environment without leaving orphaned, billable cloud resources.
- **Premium Autocomplete UX** — Designed a new glassmorphic dropdown list for search results, featuring specific badges for exchange platforms and company names for a professional, "terminal" feel.

### Changed
- **Cache Invalidation** — Bumped static asset versioning to `v=6` in `index.html` to force immediate browser updates for the new autocomplete logic and styling assets.

## [2.6.0] - 2026-04-26
### Added
- **User-Friendly AI Insights** — Reworded the AI synthesis prompt to use approachable categories: "What's Happening", "Why it Matters", and "What to Watch". This replaces convoluted technical jargon with clear, conversational summaries.
- **Smart Category Bolding** — Enhanced the frontend insight renderer to automatically detect and bold category labels before colons, improving scannability on both the home page and in details view.
- **Expanded Company Intelligence** — Increased the "About" section character limit from 800 to 3,000. This ensures that large-cap companies with extensive business models (like Amazon or Apple) are fully described without premature truncation.

### Changed
- **Human-Centric Modal Headers** — Updated detail modal section headers to be friendlier: "Quick Stats", "What Experts Say", and "Latest AI Take".
- **Enhanced Insight Formatting** — Switched insight containers to `<div>` elements with `white-space: pre-wrap` to preserve the structure of multi-point AI takes.
- **Progressive Insight Disclosure** — Home page cards now only display the most critical "What's Happening" bullet point to reduce visual clutter. The full 3-point analysis remains accessible within the expanded ticker modal.
- **Multi-Currency Support** — Added a real-time currency selector (USD, EUR, GBP, AUD, JPY) that instantly converts all prices, budget metrics, and chart axes across the entire dashboard.
- **Interactive Portfolio Chart** — Tickers in the main portfolio graph are now clickable, allowing users to jump directly to a deep-dive modal from the visualization.
- **Zero-Flicker Updates** — Disabled chart refresh animations for background data updates, ensuring a smoother, non-distracting user experience during market shifts.
- **Interactive 'How it Works' Tab** — Added a dedicated education section outlining the engine's FinOps-first architecture. 
- **Animated System Infrastructure** — Integrated a CSS-animated data flow diagram visualizing the journey from ingestion (yfinance/Google News) through the FinOps budget gate to AI synthesis (Claude 3).
- **Process Card Breakdown** — Provided a detailed 3-step technical summary of the ingestion, verification, and synthesis pipeline.

## [2.5.0] - 2026-04-17

## [2.4.0] - 2026-04-15

### Fixed
- **DynamoDB Scan Pagination Bug (Primary Root Cause)** — `GET /api/v1/market` and `GET /api/v1/insights` previously called `table.scan()` which DynamoDB silently truncates at 1MB. As MarketData accumulated 5-minute writes across 5 tickers, rows for ticker 3–5 fell past that 1MB page and were silently lost — causing META, IBM, AMD to appear as `pending_data` despite valid data existing. Replaced with per-ticker `table.query(ScanIndexForward=False, Limit=1)` calls. This is both correct (always returns the actual latest row) and more efficient (O(n_tickers) reads vs full table scan).
- **Paginated `get_active_tickers()` Scan** — The `Tickers` table scan in `src/ingestion/service.py` also lacked pagination. Applied the same `LastEvaluatedKey` loop to ensure all tracked tickers are always returned.
- **Synchronous Startup Ingestion Race** — `main.py` previously called `scheduled_job()` synchronously during `lifespan()` before the app was ready. On ECS task replacement this hit yfinance for all tickers simultaneously from a fresh AWS IP, causing throttling and partial writes. Moved to a **daemon thread with 10-second delay** so the container becomes healthy first before ingestion fires.
- **Ghost Insights for Removed Tickers** — `GET /api/v1/insights` returned stale insights for tickers like AAPL that were no longer in the Tickers watchlist. Endpoint now only returns insights for actively tracked tickers.



### Changed
- **Bar Chart Reversion** — Reverted the dashboard portfolio visualization to a vertical Bar Chart representing absolute USD prices for cleaner, high-contrast visibility across disparate asset classes.
- **Fail-Safe Ingestion Fallbacks** — Integrated a multi-layered fallback mechanism in the backend ingestion service. If a primary historical data pull fails (common for cloud IPs on late-night/weekend windows), the system now automatically falls back to `ticker.fast_info` or `ticker.info` to extract current market pricing, ensuring all tickers move from "Pending" to "Active" regardless of history availability.

## [2.3.1] - 2026-04-14

### Changed
- **Absolute Portfolio Valuation** — Transitioned the primary dashboard line chart from percentage-based normalization to absolute USD pricing. 
- **Logarithmic Price Scaling** — Integrated a logarithmic Y-axis for the portfolio summary. This prevents higher-priced assets (e.g., MSFT) from visually suppressing the volatility of lower-priced tracked assets (e.g., PLTR), ensuring absolute price moves are proportionally visible.
- **Persistent Ingestion Recovery** — Refactored the frontend ingestion loop to perform "retry until success". If a background pull fails, the system automatically re-queues the ticker for the next refresh cycle (15s) rather than locking it out.
- **Enhanced API Burst Window** — Raised the `/ingest` rate limit threshold to `300/minute` (5 requests per second) to support rapid recovery for users with large, unpopulated portfolios.
- **Fetch Resilience** — Updated backend market data logic to pull 5-day windows rather than 1-day windows, significantly reducing "stuck pending" states during global market closures or holidays.

## [2.3.0] - 2026-04-14

### Changed
- **Portfolio Chart Visualization Upgrade** — Replaced the static, absolute value Doughnut/Bar chart representation with a dynamic **Time-Series Multi-Line Chart**. Because the platform tracks highly volatile assets against massive index funds, mapping absolute `$ USD` values distorted the visual significance. All tracked assets are now historically scraped for trailing month data, mathematically normalized down to a baseline percent change index, and plotted together on an interactive layout.
- **Ingestion Limit Expansion** — To handle the newly concurrent background API sweeps needed for the Multi-Line visualizations, the backend limitation threshold for `/api/v1/tickers/{ticker}/ingest` was exponentially expanded from `5/minute` to `30/minute`.

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
