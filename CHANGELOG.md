# Changelog: Cost-Aware Market Insights Engine

All notable changes to this project will be documented in this file.


## [3.2.7] - 2026-05-18

### Changed
- **GMT Offsets in Timezone Selector** — Added explicit standard and daylight-saving GMT offset annotations (e.g. `GMT-5/-4` for New York, `GMT+10/+11` for Sydney) to all options inside the market timezone selector dropdown for intuitive regional reference.
- **Target Timezone Date & Time Completeness** — Enhanced the secondary target timezone clock widget (row 2 in the header actions bar) to show both the target date and time (e.g., `🇺🇸 NY: Mon, 18 May 2026 · 06:58:58 EDT`) for seamless regional time comparison.
- **Removed Timezone in Market News** — Streamlined publication timestamps in the main Discovery `MARKET NEWS` feed by omitting the redundant `(UTC)` or timezone abbreviation suffix, keeping labels highly readable and concise.
- **Discovery Picks News Date Restoration** — Resolved an issue where publication dates were missing in the Discovery Picks cards news feed by upgrading the parser to dynamically handle string-based ISO dates from yfinance v2 RSS formats rather than failing on assumed numeric seconds.

## [3.2.6] - 2026-05-18

### Added
- **Default Currency View Option** — Introduced a new "Default Currency" option as the out-of-the-box setting across all currency selectors. This preserves and shows the native currency of each asset (e.g., USD for US stocks, JPY for SoftBank, AUD for ASX, EUR for European assets) while providing full, accurate cross-currency FX conversion to USD, EUR, GBP, AUD, or JPY upon manual dropdown selection.
- **Premium Regional Exchange Flags** — Enhanced the market stock cards by prefixing exchange labels with their official regional flag emojis (e.g., `🇺🇸 NASDAQ`, `🇺🇸 NYSE`, `🇯🇵 JPX`, `🇨🇦 TSX`, `🇦🇺 ASX`, `🇬🇧 LSE`, `🇩🇪 DAX`).
- **Real-Time Global News Query Routing** — Developed a comprehensive brand translation mapping table for international assets in the Python backend news ingestion service. By translating raw tickers (e.g. `9984.T` or `CBA.AX`) to their clean corporate names (e.g. "SoftBank Group" or "Commonwealth Bank Australia") and stripping suffixes dynamically, the Google News RSS search engine now successfully bypasses yfinance limitations and retrieves real-time, daily news headlines for international listings.
- **Standardized DD MM YYYY News Date Format** — Overhauled date formatters across the dashboard, watchlists, discovery picks, and details modals, replacing short relative dates with a clean, standardized padded `DD MM YYYY` format for ultimate consistency.

### Changed
- **Asia Pacific Region Renaming** — Symmetrically renamed the "Asia" regions to "Asia Pacific" across both the watchlists country filters and the Top Movers geographical button selectors.
- **Robust Multi-Currency Chart Formatting** — Upgraded the details modal historical chart ticks, converting raw values from the asset's native base currency to USD and then to the target selected currency for absolute accuracy under any currency setting.

## [3.2.5] - 2026-05-18

### Changed
- **Global Market Index Regions Overhaul** — Restructured and balanced the global markets panel in the Discover tab into a symmetrical 3-column region grid. Moved **ASX 200** (`^AXJO`) under **Asia Pacific** (renamed from "Asia" with flag `🌏`), added **Toronto Exchange** (`^GSPTSE`) under **Americas** (renamed from "United States" with flag `🌎`), and added **DAX** (`^GDAXI`) under **Europe** (flag `🇪🇺`).
- **Balanced 3-Column Grid Layout** — Updated the CSS selector `.discover-indices-wrapper` to stretch elements using `repeat(3, 1fr)`, making columns beautifully proportional and filling the screen space flawlessly.
- **Accurate Market Timezone & Ingestion Sync** — Fully mapped the exchange timezones and trading hours for `^GDAXI` (XETRA, `Europe/Berlin`, `9:00 - 17:30`) and `^GSPTSE` (Toronto, `America/Toronto`, `9:30 - 16:00`) in both server-side ingestion and client-side countdown tickers.
- **Detailed Asset Summaries** — Integrated professional, high-fidelity curated descriptions and Google News RSS search term routing for the DAX Index and TSX Composite Index in the details modal view.

## [3.2.4] - 2026-05-18

### Added
- **Dynamic Frontend Countdown Timers** — Implemented a client-side ticking loop running every 10 seconds, which calculates regional market open, close, and lunch countdowns in real-time. This eliminates server polling and ensures that the timezone status tags and countdown messages update live on the dashboard without manual page refreshes.
- **Interactive Session Timeline Animation** — Connected the horizontal modal progress timeline to the client-side ticker, dynamically animating the glowing vertical current-time cursor and updating the clock tooltip in real-time.
- **Rich Discover Asset Modals** — Replaced external Yahoo Finance links on global indices and commodities in the **Discover** tab with an immersive, native details modal, providing free-of-cost charts, headlines, and descriptions without consuming AI token budgets.
- **Visual Trading Session Timeline** — Designed and integrated a horizontal 24-hour progress timeline showing active trading sessions (green neon) and midday lunch breaks (amber), along with a glowing vertical cursor mapping the exchange's current local time.
- **Custom Premium Scrollbars** — Implemented custom, dark-glass WebKit scrollbars for the details modal panel, providing a seamless and highly premium scroll experience.

### Changed
- **Regional Mover Categories (Americas, Europe, Asia)** — Overhauled the Top Movers filter options from "All | US | Internationals" to "All | Americas | Europe | Asia". Grouped raw tickers by geographic regions in the backend using precise ticker suffixes and parsed them dynamically in the frontend client logic.
- **Commodity Exact Name Titles & Subtitle Hiding** — Mapped commodity symbols (`GC=F`, `CL=F`, `SI=F`, etc.) to their exact names (e.g. "Gold", "Crude Oil", "Silver") in the details modal header title, and completely removed the redundant subtitle to clean up the visual hierarchy.
- **Wider Modal Container & In-built Scroll** — Expanded the details modal `max-width` from `1050px` to `1200px` (and width to `95%`) and improved custom scrollbar visibility to prevent overflow and wrapping of long regional prices or point numbers.
- **High-Density Statistics Row & Clean Raw Points** — Moved 52-week High and 52-week Low metrics directly into the top hero stats row alongside Close Price, Day Change, and Open for Discover/Exchange assets. Fully hid the remaining redundant corporate stats grid ("Quick Stats").
- **Exchange Point Value Formatting** — Removed currency symbols and FX conversions for global exchanges and indices (e.g., S&P 500, Nikkei, Nasdaq), displaying raw point values in card displays, modal headers, stats bars, and Chart.js tooltips.

### Fixed
- **Timeline Status Timing Bug** — Copied the computed parent `status` ("Open" or "Closed") and `message` properties directly into the `market_timeline` payload returned by `/api/v1/market/history/{ticker}`, ensuring timezone badges correctly reflect active market status (e.g. `Open`) instead of defaulting to `Closed`.

## [3.2.3] - 2026-05-18

### Changed
- **International Ticker UI** — Stripped regional suffixes (e.g., `.AX`, `.T`) from ticker displays in the UI to ensure a cleaner, more readable card layout.
- **Tokyo Exchange Hours** — Updated the `is_market_open` logic to reflect the Tokyo Stock Exchange (TSE) 2024 trading hours extension, now closing at 15:30 JST.
- **Market Status Accuracy** — Enhanced the market status chip to explicitly display a "LUNCH" state for exchanges with midday trading halts (e.g., Tokyo, Hong Kong).
- **QMJ Screener Date Format** — Formatted the "Reported" date column to display only the calendar date, stripping timestamps (e.g., `T00:00:00`) for a cleaner table layout.

### Fixed
- **Sparkline Reversion Bug** — Resolved a UI state-drift issue where international market sparklines would revert to the default 1-Day view every 15 seconds. Replaced a flawed CSS selector (which failed on tickers containing dots like `NAB.AX`) with a reliable dictionary lookup.

## [3.2.2] - 2026-05-17

### Added
- **Last Trading Day Tracking** — The ingestion service and /market API now explicitly return the `last_trading_day` for each ticker, enabling precise time-series alignment for international stocks.
- **Real Market Timestamps** — Updated historical endpoints to return actual timestamps from the data provider, eliminating frontend date guessing.

### Changed
- **Rate Limit Scaling** — Increased rate limits for `/meta/rates` and `/market/master-history` from 5/min to **60/min** to prevent 429 errors during active development.
- **Unified Period Mapping** — Implemented backend aliases for standard period codes (`1m`, `3m`, `6m`, `1y`) to match dashboard UI attributes.

### Fixed
- **Cross-Market Corruption (NAB.AX)** — Resolved a critical bug where Australian market data was shifted by a day due to timezone differences and trading holiday gaps.
- **Time-Series Alignment** — Refactored backend sanitization to ensure all tickers return identical array lengths through forced forward-filling.
- **UI Auto-Reversion** — Implemented a manual override guard and state-aware background polling to prevent automatic refreshes from resetting the user's selected chart period.
## [3.2.1] - 2026-05-15

### Added
- **Discovery Stabilization Layer** — Implemented a robust sequential fetching architecture using the proven `yf.download` method, bypassing MultiIndex parsing issues and session conflicts.
- **Unified Batch Fetching** — Consolidated all discovery sparkline requests into a single, synchronized network call in `app.js`, eliminating UI flickering and race conditions during rendering.

### Changed
- **Minimum Timeframe Standardization** — Removed 1-Day, 1-Week, and 1-Month timeframes from the Discovery dashboard. The interface now defaults to a **3-Month (3M)** minimum view to ensure 100% data reliability and trend density across all global assets.
- **Backend Interval Policy** — Standardized all historical trend requests on stable `1d` (daily) intervals, removing the dependency on high-resolution intra-day slices that were susceptible to "silent blocks" in the server environment.

### Fixed
- **Empty Sparkline Regression** — Resolved the issue where sparkline containers remained hidden or empty due to data retrieval failures for commodities and indices.
- **Sync Lag** — Eliminated the staggered loading effect of discovery charts by implementing a unified fetch-and-render pipeline.

### Known Constraints
- **Intra-Day Commodity Gaps** — High-resolution (1D/1W) data for commodities (`GC=F`, `CL=F`) is currently unavailable in the local development environment due to API resolution constraints. These views have been deprecated in favor of the stabilized 3M+ daily trendlines.

## [3.2.0] - 2026-05-15

### Added
- **1-Year Master Caching System** — Implemented a high-performance data architecture that fetches a full year of historical data in a single bulk request on app launch. This enables instantaneous (0ms) timeframe switching by slicing cached data in memory.
- **Backend Data Sanitization** — Developed a `sanitize_series` utility to forward-fill gaps (zeros/NaNs) and strip leading zeros, eliminating the "square-wave" chart effect and fixing `Infinity%` errors.
- **Real-Time "Live-Append" Logic** — Unified the 15-second market heartbeat with the historical cache. New price points are now patched directly into the 1-year history, ensuring that 1W and 1M charts remain dynamic without redundant network calls.

### Changed
- **Unified History API** — Transitioned from multiple fragmented `/api/v1/market/history` calls to a single `/api/v1/market/master-history` endpoint with 24-hour server-side caching.
- **Calculated Change Standard** — Implemented a defensive `calculateChange` utility to standardize percentage calculations across the Portfolio and Discovery sections.

### Fixed
- **Discovery Chart Regressions** — Resolved the issue where Global Markets and Commodities charts failed to render or displayed invalid "NaN" metrics.
- **Portfolio Color Sync** — Fixed the trend-aware color synchronization for portfolio sparklines, ensuring green/red gradients correctly reflect historical performance.

## [3.1.8] - 2026-05-14

### Added
- **Multi-Period Portfolio Analytics** — Integrated a glassmorphic timeframe selector (1D, 1W, 1M, 3M, 6M, 1Y) to the "Tracked Assets" section.
- **Dynamic Performance Labels** — Added a real-time percentage change indicator that synchronizes with the selected chart period, featuring semantic color-coding and trend symbols (↑/↓).
- **History Aggregation Engine** — Refactored the frontend chart logic to automatically aggregate historical data from multiple global tickers into a single, unified portfolio value line.
- **Loading State UI** — Implemented an "Aggregating History..." loader overlay for the portfolio chart to provide visual feedback during asynchronous data fetches.

### Changed
- **Timeframe-Aware Background Refresh** — Optimized the 15-second "heartbeat" to respect the user's selected timeframe. Background updates now only refresh the 1D sparkline data, preventing the chart from resetting while viewing historical trends.
- **Asynchronous Chart Lifecycle** — Converted the portfolio visualization engine to be fully asynchronous, enabling non-blocking fetches of trailing market data.

### Fixed
- **State Drift Regression** — Resolved a bug where background market updates would force the portfolio timeframe back to "1D" every 15 seconds.
- **JS Syntax Protection** — Fixed a `SyntaxError` caused by duplicate variable declarations (`statEl`) in the chart update routine.

## [3.1.7] - 2026-05-14

### Added
- **Parallel Movers Enrichment** — Implemented `ThreadPoolExecutor` in the backend to fetch company metadata for 60+ tickers simultaneously. This reduces Top Movers load time by ~90% (from 30s+ down to ~3s).
- **Stale-While-Revalidate Caching** — The Movers API now returns cached data instantly while refreshing the list in a background thread if the data is older than 15 minutes.

### Changed
- **Rate Limit Increase** — Raised the Movers API rate limit from 10/min to 20/min to support the faster, more frequent UI refreshes enabled by the new caching model.


## [3.1.6] - 2026-05-14

### Added
- **Recent News Catalysts** — Integrated a live news ticker into Discovery cards, surfacing 3 real-time headlines per pick directly from Yahoo Finance.
- **Regional Movers Filter** — Implemented a glassmorphic selector on the Discovery tab to toggle between "All", "US", and "International" market movers.
- **Global Debug Flag** — Introduced a centralized `APP_DEBUG` flag and `debugLog()` helper to sanitize the browser console and optimize main-thread performance.

### Changed
- **Unified Discovery Rationale Rendering** — Standardized the discovery card template to use a flexible 1-column layout that prioritizes the high-conviction "Why" and "Numbers" thesis above the news feed.
- **News Labeling** — Updated "Recent Catalyst" labeling to "Recent News" across the UI for better end-user clarity.

### Fixed
- **Yahoo Finance News Regression** — Resolved a critical news-retrieval failure caused by a breaking change in Yahoo Finance's internal data structure (nested `content` objects). Implemented a hardened, recursive extraction logic with defensive fallbacks to eliminate `null` headlines.
- **Movers API Categorization** — Fixed a backend logic error in `discover.py` that prevented movers from being correctly partitioned by region.


## [3.1.4] - 2026-05-14

### Added
- **Inline Sparkline Strip** — Repositioned the watchlist card sparkline from a background overlay into a dedicated inline strip (64px) placed between the price header and the AI analysis section. This follows the same visual language as the Gold commodity card in the Discover tab.
- **Gradient Area Fill on Watchlist Sparklines** — Added a colour-matched gradient wash beneath the sparkline line (`color + '55'` → `color + '00'`) for a premium, depth-layered effect consistent with the Discover tab's commodity cards.

### Changed
- **Sparkline DOM Order** — The sparkline container (`#sparkline-card-{ticker}`) is now emitted after the `.card-header` block and before the `.insight-text` block, acting as a clear visual separator between market data and AI narrative.
- **CSS Class Refactor** — Replaced the legacy `.card-sparkline-box` / `.sparkline-inner` inline approach with a new `.card-sparkline-bg` class. The old `.card-sparkline-box` is now hidden via `display: none` to preserve compatibility with density-wide/horizontal layout overrides.
- **Removed Absolute Positioning** — Reverted the card's `.glass` element from `position: relative; overflow: hidden` back to its default flow, as the absolute background approach was discarded in favour of the inline strip.

### Fixed
- **Z-Index Stacking Cleanup** — Removed the temporary `z-index: 1; position: relative` declarations from `.card-header` that were added to support the now-abandoned absolute sparkline layer.

---

## [3.1.3] - 2026-05-14

### Changed
- **Deterministic Discovery Engine** — Eliminated the AI-selection shortlist model in `bedrock_recommend_node`. The algorithm now pre-selects the single highest-momentum ticker per category (S&P 500, Global Opportunity, Hidden Gem) using a `get_best()` comparator before any LLM call is made, making it impossible for the model to misattribute analysis to the wrong company.
- **Isolated Per-Ticker AI Calls** — Replaced the single multi-candidate prompt with three sequential, focused API calls. Each call receives exactly one ticker, with the prompt explicitly forbidding the model from referencing or analysing any other company.
- **Force-Overwrite Ticker Field** — After parsing the AI response, the `ticker` and `category` fields are overwritten with the algorithm's pre-selected values, providing a final hard safeguard against model drift regardless of what the LLM returns.
- **Reduced Temperature & Token Budget** — Lowered generation temperature from `0.3` → `0.2` and max tokens from `1500` → `800` per call. Each prompt targets a single stock, requiring less output, improving determinism, and reducing per-run cost.
- **Category Labels Corrected** — Swapped the `_DAILY_GLOBALOPPORTUNITY_` and `_DAILY_HIDDENGEM_` slot labels in `insights.py` to correctly map international blue-chip picks to **Global Opportunity** and high-potential quality picks to **Hidden Gems**.

### Fixed
- **Sony/ASML-Type Hallucination** — Resolved the root-cause architecture flaw where a single prompt containing multiple candidate tickers allowed the model to cross-wire analysis between companies (e.g., writing ASML's description under Sony's ticker). The new one-prompt-per-ticker design structurally prevents this class of error.
- **Stale Fallback Block Removed** — Excised a leftover dead-code block from the previous shortlist architecture (`get_best` / `recs` assignment inside a malformed `except` clause) that was syntactically invalid and unreachable.
- **Per-Ticker Error Isolation** — AI failures for one category no longer abort the entire discovery run. Each `call_ai` invocation has its own `try/except` with a structured placeholder fallback, ensuring the other two picks are always returned.

---



### Added
- **Structured Research Thesis Architecture** — Overhauled the AI research pipeline to output a strictly enforced 5-key JSON structure: **Why, Numbers, Catalysts, Risks, Bottom Line**.
- **Smart 2-Column Dashboard Layout** — Implemented a premium, institutional 2-column layout for Discovery picks (Bold Labels on left, Analysis on right).
- **Intelligent Rationale Filtering** — Dashboard cards now perform "Information Pruning," showing only **Why** and **Numbers** for scannability, while the ticker modal expands to show the full research report.

### Changed
- **Optimized Exchange Branding** — Standardized all exchange labels to be at most 2 words (e.g., "NASDAQ GS", "ASX") to maintain consistent high-density grid rhythm.
- **Full-Width Dashboard Centering** — Centered the main dashboard container (`max-width: 1600px`) to better utilize ultra-wide high-resolution displays.

### Fixed
- **Discovery Pipeline Regression** — Resolved a critical data integrity issue where rationale was being stored/treated as a raw string instead of a structured object.
- **Three-Layer Serialization Fix** — Implemented robust data stabilization across the entire stack:
    - **Backend**: Forced JSON-dict parsing and serialization in `discovery_graph.py`.
    - **API**: Added proactive `json.loads()` deserialization in `insights.py`.
    - **Frontend**: Added a `JSON.parse()` safety net in `app.js`.
- **Automatic "Why" Mapping** — Added a frontend fallback that automatically wraps legacy plain-text analysis into the 2-column "WHY" section, ensuring UI stability for older records.
- **Case-Insensitive Key Parsing** — Hardened the frontend renderer to correctly handle inconsistent AI key casing (e.g., "WHY" vs "Why") and whitespace.
- **Ticker-Company Alignment** — Fixed a data-drift bug where ticker symbols and descriptions occasionally mismatched during discovery synthesis.

## [3.1.1] - 2026-05-13

### Added
- **Institutional QMJ Screener UI** — Rebuilt the screener as a high-density, glassmorphic grid designed for institutional-grade data analysis.
    - **Sticky Headers & Scrolling**: Implemented a fixed-height scrollable viewport with sticky headers for 600+ records.
    - **Z-Score Heatmapping**: Integrated semantic "pills" that color-code assets based on quality metrics (Profitability, Safety, etc.).
- **High-Performance Filtering & Pagination** — Added client-side state management for fast interactions:
    - **Local Pagination**: Selectable 25, 50, or 100 rows per page.
    - **Multi-Factor Search**: Real-time filtering by Ticker, Industry, and Company Name.
- **Improved UI Error Reporting** — The dashboard now displays specific error messages (e.g., specific fetch failures) instead of generic strings.

### Changed
- **Standardized API Routing** — Unified the screener endpoints under the `/api/v1` namespace (moving to `/api/v1/screener/qmj`) for architectural consistency.

### Fixed
- **Critical Pipeline Crash** — Resolved an `IndentationError` in `src/ingestion/financials.py` that caused background ingestion and API startup to fail.
- **JS ReferenceError** — Added the missing `debounce` utility function to `app.js`, fixing a crash during search interactions.
- **Network Resilience** — Fixed a routing mismatch between the FastAPI backend and frontend fetch calls that caused "Network Error" alerts.

## [3.1.0] - 2026-05-13

### Added
- **Global Discovery Agent Expansion** — Transitioned from a US-centric model to a global market insights platform.
    - Integrated **ASX (Australia)**, **LSE (UK)**, **HKEX (Hong Kong)**, **NSE (India)**, and **TSX (Canada)** into the daily discovery pipeline.
- **Three-Category Discovery Model** — The agent now surfaces three distinct opportunities:
    - **S&P 500 Leader** (US Mega-Cap)
    - **Global Opportunity** (International Blue Chip)
    - **Hidden Gem** (High-Potential Quality Small/Mid-Cap)
- **Autonomous Auto-Healing & Resilience** — Implemented a background polling loop that automatically repairs missing AI summaries, ensuring analysis is always available.
- **Cost-Optimized Targeted Refresh** — Re-architected the refresh system to separate cheap market data updates from expensive AI synthesis.
- **Premium Discovery UI** — Introduced 3-column desktop layout and distinct color-coding (Amethyst, Emerald, Amber) for asset categories.

### Changed
- **Rate Limit Optimization** — Increased server-side rate limits to 5 requests/minute to accommodate the auto-healing polling loop.
- **Refinement-Only Manual Refresh** — Manual refresh button now strictly skips the AI DAG to save tokens, deferring analysis to the auto-healing loop.

### Fixed
- **Discovery Category Leakage** — Resolved an issue where S&P 500 stocks (e.g., TSLA) were appearing in the "Hidden Gem" category.
- **DAG Syntax Resilience** — Fixed critical indentation and syntax errors in `discovery_graph.py` that caused background task failures.

## [3.0.0] - 2026-05-13

### Added
- **High-Conviction Discovery Agent** — Major overhaul of the discovery pipeline, transitioning from momentum-only logic to a multi-factor research engine.
- **Quant Analyst node** — Implemented technical modeling in the Discovery DAG:
    - **RSI-14** (Relative Strength Index) calculation.
    - **SMA-200 Distance** (Trend health check).
    - **Annualized Volatility** (Risk assessment).
- **Fundamental Research node** — Integrated deep-dive factor ingestion:
    - **Quality**: ROE and Revenue Growth tracking.
    - **Value**: P/E Ratios and Analyst Target Upside detection.
- **Consensus synthesis** — Redesigned AI prompts to act as a committee of analysts, generating data-backed investment theses with technical and fundamental evidence.
- **Dynamic Universe Sampling** — The Discovery Agent now randomly samples 25 assets from a pool of 75+ movers every 12 hours, ensuring twice-daily freshness.
- **Enhanced Discovery UI** — Updated pick cards to display **RSI** and **SMA-200** stats directly for instant validation.
- **Watchlist Integration** — Added "Add to Watchlist" functionality directly within the Discovery Detail Modals for seamless asset tracking.
- **Manual Force-Refresh** — Implemented an API endpoint and dashboard button to manually trigger the Discovery Agent and clear market caches for real-time updates.
- **Toast Notification System** — Added a sleek feedback system for dashboard actions like refreshing and watchlist management.

### Fixed
- **Environment-Aware AI** — Hardened the provider selection logic to automatically toggle between Bedrock (Prod) and Ollama (Local) based on deployment context.
- **Discovery News Hydration** — Resolved a persistence issue where news headlines weren't appearing in detail views for daily picks.

## [2.9.9] - 2026-05-12

### Added
- **Dynamic Budget Management** — Introduced a persistent configuration layer for FinOps, allowing real-time adjustments to AI spending limits.
- **Budget Control UI** — Added a sleek, glassmorphic toggle and numeric input to the Costs tab for managing daily dollar caps.
- **SystemSettings Persistence** — Created a new DynamoDB table to store runtime-mutable system settings.
- **Dynamic Enforcement API** — Added `POST /api/v1/costs/settings` to synchronize frontend controls with the backend budget gate.

### Changed
- **Heuristic Budget Prioritization** — The `check_budget` service now prioritizes DynamoDB-backed settings over static environment variables.

## [2.9.8] - 2026-05-12

### Added
- **Institutional Pivot** — Decoupled "Tracked Monitoring" from "Global Screening" to streamline the primary dashboard.
- **FAANG-Centric Watchlist** — Reverted the default dashboard ticker list to a high-signal focused set (`META`, `AAPL`, `AMZN`, `NFLX`, `GOOGL`).
- **Dashboard Reset Utility** — Added `scripts/reset_dashboard.py` to purge bloated ticker metadata and restore dashboard focus.

### Changed
- **Screener Isolation** — Optimized the QMJ Screener to maintain the full 600+ ticker universe in the analytical layer (DuckDB) while the active dashboard remains focused on institutional assets.
- **Ingestion Guardrails** — Disabled unauthorized mass-seeding in `scripts/seed_universes.py` to prevent future ticker bloat.

### Fixed
- **Python 3.9 Compatibility** — Resolved type hinting issues and runtime errors specific to Python 3.9 environments.
- **UI Function Synchronization** — Renamed `applyQmjTable` to `renderQMJScreener` for architectural consistency and resolved event listener detachment bugs.

## [2.9.7] - 2026-05-11

### Added
- **5-Factor QMJ Model**: Expanded fundamental scoring to include Profitability, Growth, Safety, Valuation (Earnings Yield), and Momentum.
- **Universal Screener**: New "All Universes" toggle allowing side-by-side comparison of S&P 500 and ASX stocks.
- **Scrollable Viewport**: Implemented fixed-height, scrollable container for the screener table with sticky headers.
- **Dynamic Z-Score Fallback**: Added on-the-fly Z-score calculation in `WarehouseClient` to ensure metrics are always present.

### Fixed
- **Screener Overlap**: Fixed issue where universe data would mix; forced default view to S&P 500.
- **UI Performance**: Optimized table rendering to handle large datasets without layout flickering.

## [2.9.6] - 2026-05-11

### Added
- **Expanded Universe & Filtering** — Added toggle to dynamically switch the QMJ Screener between S&P 500 and ASX universes.
- **Force Refresh Engine** — Integrated a throttled manual refresh button to trigger instantaneous data ingestion across all endpoints, capped at a 30-second interval to prevent API saturation.
- **Enhanced Tooltips** — Appended native, explanatory tooltips to the QMJ Screener column headers (QMJ Score, Profitability, Growth, Safety, Valuation, Momentum).
- **Extended Commodities Tracking** — Added Aluminium, Copper, Nickel, and Tin with seamless Metric/Imperial unit conversion logic.
- **Architecture Diagram** — Finalised and exported the comprehensive system agent architecture via Mermaid.

### Fixed
- **Discover UI Streamlining** — Removed redundant currency dropdowns from news sections to improve vertical rhythm and readability.
- **Commodities Typography** — Tightened layout alignments and unit display constraints within the Commodities dashboard.

## [2.9.5] - 2026-05-11

### Added
- **Documentation Consolidation** — Migrated the "Alpha-DAG Pivot" and "Colima Networking" technical logs from the `README.md` to the dedicated `DEVELOPMENT_BLOG.md`.

### Fixed
- **UI Structural Stability** — Corrected nested HTML `div` imbalances in the "How it Works" section of `index.html` to prevent documentation content from leaking into other dashboard tabs.
- **QMJ Screener UI** — Refined the screener table layout with minimum widths to prevent column overlap in high-density views.

## [2.9.4] - 2026-05-11

### Added
- **Global QMJ Screener** — Integrated a quantitative "Quality Minus Junk" (QMJ) screener directly into the dashboard.
- **Open Data Lakehouse Architecture** — Implemented a dual-engine transformation pipeline using dbt Core.
  - Development runs cost-free using DuckDB over local JSON files.
  - Production scales serverlessly using AWS Athena over S3.
- **Fundamental Ingestion** — Expanded the Market Data MCP to fetch comprehensive financial statements (Income Statement, Balance Sheet, Cash Flow) directly from yfinance.
- **QMJ Scoring Model** — Developed modular SQL logic to compute proxy Profitability (ROE, ROA, Cash Flow Margin) and Safety (Leverage Ratio) scores, ranked across the tracked universe using `PERCENT_RANK`.

## [2.9.3] - 2026-05-08### Added
- **Global Currency Localization** — Implemented comprehensive support for international markets including Hong Kong (**HKD**), Canada (**CAD**), Singapore (**SGD**), and New Zealand (**NZD**).
- **Exchange-Aware Formatting** — The dashboard now automatically applies native currency symbols (¥, HK$, A$, etc.) based on an asset's primary exchange, ensuring accurate labeling even when the global base currency is set to USD.
- **Live FX Fetching** — Integrated a real-time exchange rate bridge using the Yahoo Finance FX API, providing live-updated conversion metrics for all supported global currencies.

### Fixed
- **Discovery Agent Stability (Ollama)** — Overhauled the LLM response parsing in the Discovery Alpha-DAG. The agent now uses a robust regex-based "Flexible JSON" extractor that handles both List and Dictionary outputs, resolving parsing failures specific to local models like Llama 3.2.
- **Malformed Record Recovery** — Added defensive checks to the data persistence layer to gracefully skip malformed LLM records instead of crashing the entire discovery cycle.
- **Regional Pricing Precision** — Optimized decimal display and unit normalization for international assets (e.g., GBp to GBP conversion and 0-decimal JPY formatting).

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
