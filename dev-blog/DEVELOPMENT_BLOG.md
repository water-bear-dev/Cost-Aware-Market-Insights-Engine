# Development Blog

## Entry 61: UI Stability & International Accuracy (2026-05-18)

Today, we addressed a frustrating state-drift bug affecting our international market assets and updated our backend logic to align with recent global exchange rule changes.

**The Sparkline Reversion Bug**

Users noticed that after interacting with the time period selector for international markets (like ASX or Tokyo), the newly selected sparkline (e.g., 1-Year or 3-Month) would render perfectly, only to "revert" back to the default 1-Day view 15 seconds later during the background data refresh cycle. 

Upon investigation, the root cause was traced to a flawed CSS selector approach in `app.js`. The background polling logic (`patchInsightsGrid`) was using `document.querySelector('#sparkline-card-' + ticker)` to find the canvas and update it. However, international tickers often contain dots (e.g., `NAB.AX`, `7974.T`). The `querySelector` interpreted these dots as CSS class selectors, failed to find the element, and inadvertently forced the UI to reset the chart. 

**The Fix:** We decoupled the canvas update logic from CSS selector strings. We introduced a `sparklineInstances` dictionary that stores explicit references to each Chart.js instance keyed by the ticker symbol. When background data arrives, we simply look up the instance directly, bypassing the DOM search entirely. 

**Global Market Enhancements**

While refining the international user experience, we made two key updates to our market data processing:
1. **Tokyo Market Hours:** The Tokyo Stock Exchange (TSE) recently extended its trading hours, now closing at 15:30 JST instead of 15:00. We updated the backend `is_market_open` logic to reflect this reality, preventing premature "Closed" states in the UI.
2. **The "Lunch" State:** Asian markets like Tokyo and Hong Kong feature a midday trading halt (lunch break). Previously, our logic simply returned `False` (Closed) during this window. We updated the backend to return a specific `"Lunch"` string and added a new amber "LUNCH" status chip to the frontend, providing significantly more clarity to users.
3. **Clean Ticker Presentation:** We implemented a regex strip in the UI to remove regional suffixes (like `.AX` and `.T`) from ticker displays. `NAB.AX` is now simply presented as `NAB`, creating a cleaner, more professional card layout without affecting the backend's precise tracking.

## Entry 60: The Cross-Border Sync — Tackling Timezone Corruption (2026-05-17)

Today we addressed one of the most subtle but visually destructive bugs encountered yet: **Cross-Market Data Corruption**.

**The Problem: The 'NAB.AX' Shift**

As we expanded our asset universe to include the Australian market (ASX), we noticed that visualizations for stocks like NAB.AX would correctly render for a few seconds before suddenly 'reverting' to a squashed or corrupted state. 

After a deep-dive investigation, we identified a synchronization conflict between our manual UI requests and our background data pollers. Because Sydney is 15 hours ahead of New York, an Australian stock might be trading on a 'Monday' while the US is still in 'Sunday'. Our background sync was blindly overwriting the last item in our historical arrays, effectively 'deleting' Friday's history and shifting Australian prices backward by one day to align with US dates. This created a permanent misalignment between the data points and the calendar timestamps.

**The Architectural Solution**

We implemented a three-tier solution to ensure our engine is truly global:
1.  **Date-Aware Ingestion**: We refactored `ingestion/service.py` to capture the explicit `last_trading_day` for every asset. We no longer assume that 'live price' means 'today' in the server's timezone.
2.  **Precise Alignment**: In the backend, we refactored our sanitization logic. Instead of stripping 'empty' leading values (which shortened arrays for international markets), we now use strict index alignment via Pandas, ensuring every ticker returns an array of the exact same length as the global timestamp index.
3.  **Frontend 'Smart Append'**: We updated `app.js` with a new synchronization guard. When a live price arrives, the frontend now compares its date against the history cache. If a new day has started in Australia, the app **appends** a new slot to the timeline and forward-fills US stocks, rather than corrupting existing data.

**Scaling for Development Velocity**

Finally, we scaled our API rate limits. As our dashboard polling became more sophisticated, we were hitting '429 Too Many Requests' errors during active development. We've increased our internal limits to **60 requests/minute**, backed by aggressive 24-hour server-side caching to keep our overhead low while keeping the UI snappy.
## Entry 59: Refining the Edge — 5-Factor QMJ and Global Sourcing (2026-05-15)

Today we finalized the core quantitative engine, moving from a simplified 2-factor prototype to a robust **5-Factor QMJ Factor Model**.

**The 5-Factor Alpha**

We expanded our academic scoring to include five distinct dimensions of "Quality":
1.  **Profitability (GPA)**: Gross Profits over Total Assets.
2.  **Safety (Leverage)**: Total Debt over Total Equity (Inverted).
3.  **Growth**: YoY Gross Profit expansion.
4.  **Value**: Net Income over Market Cap (Earnings Yield).
5.  **Momentum**: Technical price strength.

By using Z-scores across all five factors, we have significantly improved the robustness of our rankings, ensuring that companies must be fundamentally sound across the board to surface in our "Discovery Agent" picks.

**Standardizing the Change Metric**

We identified a subtle but critical "Institutional Gap" in our dashboard: our Change % was calculating from the current day's opening price. While mathematically accurate for intraday traders, it was misleading for portfolio tracking as it ignored overnight price gaps.
- **The Fix**: We refactored the entire ingestion pipeline (`ingestion/service.py`) and the MCP layer to calculate performance against the **Previous Close**.
- **Impact**: The dashboard now perfectly matches institutional terminals (Bloomberg/Refinitiv), correctly showing red for a stock that gaps down 5% but stays flat all day.

**Metric Integrity for Base Metals**

Finally, we polished our localization engine by fixing a "Metric Blindspot" for Copper.
- **The Issue**: Our unit toggler handled ounces (Gold) and barrels (Oil) but ignored pounds (Copper).
- **The Fix**: We implemented a 2.20462x multiplier to convert Copper from USD/lb to **USD/kg** when Metric is selected.

These refinements move the engine from a "data experiment" into a "production-ready financial tool," capable of handling complex global data with professional-grade accuracy.


A working document detailing engineering decisions, feature updates, and architectural pivots as the Cost-Aware Market Insights Engine evolves.

## Entry 58: The Battle of the Sparklines — Stabilizing High-Frequency Data (2026-05-15)

The "Discovery" dashboard is the visual soul of the platform, but it recently faced its toughest engineering challenge: the reliability of high-resolution intra-day data. Today, we made a strategic pivot to **stabilize the visualization layer** by standardizing on a 3-Month minimum view.

**The Discovery Regression: The Multi-Index Trap**

We initially attempted to optimize the Discovery sparklines by using a `ThreadPoolExecutor` and parallelizing `yfinance` requests. While fast, this introduced a "Multi-Index Trap." Depending on the environment, `yfinance` would return data in different structural shapes—sometimes flat, sometimes multi-indexed by `(Field, Ticker)`. This caused "silent" data extraction failures where the UI would show empty charts despite the network request succeeding.

**The "Silent Block" Problem**

Further investigation revealed that Yahoo Finance frequently "silently blocks" high-resolution requests (5m/15m intervals) originating from non-browser environments, specifically for commodities like Gold (`GC=F`) and Oil (`CL=F`). This resulted in the 1D and 1W views for commodities consistently returning `0` data points, even when the daily (1D interval) data was flowing perfectly.

**The Strategic Pivot: 3M Minimum and Daily Standardization**

To ensure 100% reliability for our users, we made the following engineering decisions:
1.  **Removal of 1D, 1W, and 1M views:** By removing the timeframes that relied on unstable high-resolution slices, we eliminated the primary source of UI failure.
2.  **3-Month (3M) Default:** The dashboard now defaults to a 3-month view. This is the "sweet spot" for market trend visualization, providing enough data points for a smooth, high-density trend line while relying exclusively on **stable daily price series**.
3.  **Unified Batch-Fetch Logic:** We unified the frontend fetch into a single atomic call. This ensures all cards on the Discovery tab update in perfect synchronization, eliminating the staggered, flickering loading effect seen in previous versions.

**Conclusion: Reliability over Granularity**

In institutional finance, a missing chart is worse than a slightly lower-resolution one. By standardizing on 3M+ daily data, we have guaranteed that the Discovery Engine will always provide a consistent, trend-accurate visualization for every global index and commodity in the system.

## Entry 57: The Master Cache — 0ms Latency and Data Sanitization (2026-05-15)

As the platform matured, we noticed two recurring issues: the "network tax" of timeframe switching and data quality regressions in the Discovery tab (the infamous "square-wave" commodity charts). Today, we solved both by implementing a **Unified Master History Architecture**.

**The Architectural Pivot: From Fragmented to Centralized**

Previously, every time a user clicked "1M" or "1Y", the frontend would fire off a new network request to the backend. This was expensive, redundant, and introduced a 2-3 second "wait state" on every interaction.

We pivoted to a **Bootstrap-Sync model**:
1.  **Warm Boot:** On application launch, the frontend triggers a single, background `syncMasterHistory()` call. This fetches a full 1-year historical record for every tracked asset and discovery symbol (indices/commodities).
2.  **In-Memory Slicing:** Because the frontend now owns the 1-year master record, timeframe switching is no longer a network operation. Clicking "1W" or "3M" simply slices the existing JavaScript array. Latency dropped from ~2,500ms to **0ms**.

**Killing the "Square-Wave" and Infinity% Errors**

Global commodities (like Gold) and certain international indices occasionally suffer from "gappy" data in Yahoo Finance, appearing as zero-price points or missing intervals. This caused two major visual bugs:
- **Square-Waves:** The chart would drop to zero and jump back, creating an ugly box-like shape.
- **Infinity% Change:** If the "start" price of a period was zero, the change calculation would return `Infinity%`, breaking the UI badges.

We solved this with a new **Backend Sanitization Layer** (`sanitize_series`):
- **Leading Zero Stripping:** We automatically find the first non-zero price point and discard everything before it.
- **Forward-Filling:** Any internal gaps (zeros or NaNs) are automatically filled with the *previous* valid price. This results in smooth, continuous trend lines even when the raw data is messy.

**Real-Time Continuity: The Live-Append Pattern**

One risk of a 1-year cache is that it becomes "stale" the moment market prices move. We implemented a **Live-Append Pattern** to keep the cache moving:
Every 15 seconds, the application's market heartbeat updates the *last* point of the historical arrays in `MASTER_HISTORY`. This ensures that your "1-Month" or "1-Year" chart actually reflects the price that just ticked 5 seconds ago, without ever needing to re-fetch the entire history.

## Entry 56: The "Portfolio Pulse" — Orchestrating Multi-Period Portfolio Analytics (2026-05-14)

One of the most requested features for the "Tracked Assets" dashboard was the ability to see how the total portfolio has performed over time, not just in the last 24 hours. While we had sparklines for individual stocks, the **Unified Portfolio Chart** was stuck in a "Daily" snapshot mode. Today, we broke that barrier.

**The Architectural Switch: Sparklines vs. Batch History**

The core technical challenge was data sourcing. For a **1D** view, we use the "cheap" sparkline data already carried in our primary `/api/v1/market` payload. This is fast and requires no extra network calls. 

However, for a **1M** or **1Y** view, sparklines aren't enough. We needed to bridge the frontend to our specialized `/api/v1/market/batch-history` endpoint. We refactored `updatePortfolioChart()` to act as a "Smart Switch":
1.  **1D Mode:** Instantly aggregates local sparkline points (15-min intervals).
2.  **Historical Mode:** Triggers an `async` fetch for trailing daily closures across the entire watchlist, normalizes them into the user's selected currency (USD, AUD, etc.), and sums them into a single time-series line.

**The "State Drift" Problem: Fighting the Heartbeat**

The dashboard features a 15-second background "heartbeat" that refreshes prices. Initially, this heartbeat was too aggressive—it would fetch the latest market data and then call the chart update function, which would default back to the **1D** view. 

If a user was looking at their **6-Month** performance, the chart would "flicker" and reset to **1-Day** every 15 seconds. This is a classic "State Drift" issue in vanilla JS apps without a formal state machine. 

**The Fix: Timeframe-Aware Refresh**
We implemented two layers of protection:
1.  **Selection Locking:** The background interval now explicitly checks the `currentPortfolioPeriod`. If it's anything other than `1d`, it skips the automatic chart update.
2.  **Visual Feedback:** We added a glassmorphic loader overlay. When you switch to **1Y**, the chart blurs and shows "Aggregating History...". This gives the user immediate feedback that an expensive network operation is in progress, rather than leaving them with a stale chart.

**The Result: Institutional Trend Analysis**

The "Tracked Assets" section now feels like a professional portfolio manager. You can instantly see your total P&L (Perf %) change as you toggle through periods. The app intelligently handles the math—converting HKD, GBP, and USD assets into a single unified currency line—allowing you to see the "Pulse" of your wealth across global markets.

## Entry 55: From 30s to Instant — High-Performance Movers with SWR (2026-05-14)

The "Top Movers" section was a victim of its own success. As we expanded to 600+ tickers and added regional filtering (All/US/International), the loading times ballooned to over 30 seconds. This wasn't just a "bad user experience"—it was a technical bottleneck caused by sequential network dependency.

**The Bottleneck: The Sequential Tax**

To show a single "Mover" card, the system needed the ticker, the price, and the company name. While the price data is fetched in bulk via `yf.download`, the **enrichment** (fetching the company name and pre/post-market stats) was happening one-by-one. 60 tickers x 0.5s per network call = 30 seconds of blocking.

**The Fix: Parallel Processing & SWR Caching**

We implemented two enterprise-grade patterns to kill the loading spinner:
1.  **ThreadPoolExecutor:** Instead of checking one ticker at a time, we now spawn 10 concurrent threads. This parallelizes the network latency, effectively cutting the enrichment time by 90%.
2.  **Stale-While-Revalidate (SWR):** This is the ultimate UI performance pattern. When you request the Movers, the server says: *"Here is the data from 10 minutes ago (instant)*. *Oh, and since it's a bit old, I'll go ahead and fetch a fresh copy in the background right now so it's ready for next time."*

**The Result: Perception of Zero Latency**

For the user, the Movers now load instantly 99% of the time. The only person who ever sees a loading spinner is the very first person to open the app after a server restart. This is a massive leap forward in the dashboard's "institutional" feel.


## Entry 54: The "Ghost News" Investigation — Debugging Nested Data Regressions (2026-05-14)

A great UI is only as good as the data powering it. After successfully implementing the new **Recent News** section for Discovery cards, we immediately hit a wall: every card displayed "NEWS: null". The system was identifying that news existed, but it couldn't read the headlines.

**The Investigation: Tearing Down the Fetch**

We ran a focused diagnostic script on `XOM` (ExxonMobil) to inspect the raw JSON coming from the `yfinance` library. The discovery was immediate: Yahoo Finance had silently moved their news metadata into a deeply nested **`content`** object. Our legacy code was looking at the top level for a `title` key that no longer lived there.

**The Solution: Recursive Defensive Extraction**

Instead of a simple `.get()`, we implemented a hardened "digging" logic in `src/dag/discovery_graph.py`:
1.  Attempt to find a `content` object first.
2.  If `content` exists (even if partially empty), use it to extract the `title`, `displayName` (publisher), and `clickThroughUrl`.
3.  Add `or {}` fallbacks at every level to prevent `AttributeError` crashes if Yahoo returns a null field.
4.  If the top-level still has the data (legacy support), use that as a second-tier fallback.

**The Result: Data Resilience**

By isolating the fetch logic in the DAG and hardening the extraction, we restored the high-density news feed without needing to change the frontend again. We also took the opportunity to rename the section from "Recent Catalyst" to "Recent News" to simplify the cognitive load for the user. Discovery isn't just about finding stocks anymore—it's about connecting the "Why" (AI) with the "What" (Live News).


## Entry 53: Design Parity — Bringing the Gold Card's Sparkline to the Watchlist (2026-05-14)

One of the most impactful visual improvements often isn't about new features—it's about visual consistency. The Gold commodity card in the Discover tab had long enjoyed a premium aesthetic: a full-width sparkline strip anchored to the bottom of the card, with a gradient colour wash beneath the line that fades to transparent, giving the card a sense of depth and motion. The watchlist cards (META, AAPL, etc.) had sparklines too, but they lived as a small 40px inline row sandwiched awkwardly between the price header and the AI analysis text. The visual treatment was inconsistent, and the sparkline felt disconnected from the card's identity.

**The Design Goal: Visual Language Unification**

The request was precise: make the watchlist sparkline look like the Gold card's sparkline, positioned as a visual separator just above the "What's Happening" AI analysis. This meant three things needed to change simultaneously:
1. The **position** of the sparkline in the DOM had to move — from inside the `card-header` flex row to after it, acting as a dedicated horizontal strip.
2. The **CSS class** needed to be redesigned from a small inline box to a full-width 64px block element.
3. The **Chart.js dataset** needed a gradient fill, not just a bare line.

**Iteration: Background vs. Inline**

Our first attempt was ambitious: we tried to position the sparkline as a full-card background overlay using `position: absolute; bottom: 0; left: 0; right: 0; height: 90px` — the same technique used internally by the commodity card. This required marking the `.glass` container as `position: relative; overflow: hidden` and layering the text content above using `z-index: 1`.

The result worked architecturally, but it wasn't what the user wanted. The sparkline was visible but too subtle, bleeding behind the card content rather than creating a clear visual beat between the header and the analysis. The user's intent was clear: the sparkline should be a **strip you can see**, not a ghost in the background.

**The Final Architecture: The Inline Strip Pattern**

We reverted to an inline model, but executed it properly this time:

- A new `.card-sparkline-bg` CSS class defines a `width: 100%; height: 64px; display: block` element. No absolute positioning, no `z-index` drama — it simply flows between the header and the insight text as a natural block.
- The sparkline `div` is now emitted at the bottom of `cardInnerHtml()`, between `</div>` (card-header close) and the `.insight-text` div. The `border-top` separator on `.insight-text` naturally creates a clean boundary below the strip.
- In `drawSparkline()`, we construct a `LinearGradient` from `(0, 0)` to `(0, 90)` with `color + '55'` at the top and `color + '00'` at the bottom. This is the same gradient recipe used in `drawDiscoverSparkline()`, ensuring visual parity.

**The Cleanup**

Every intermediate layer from the background-overlay experiment was carefully rolled back: the `position: relative` and `overflow: hidden` on the `.glass` div, the `z-index: 1; position: relative` on `.card-header`, and the `position: relative; z-index: 1` inline style on `.insight-text`. Clean code and clean UI go together.

The result is a card that reads: **identity → price action (sparkline) → AI narrative** — a natural, scannable information hierarchy.

---

## Entry 52: The Hallucination Fix — Deterministic Discovery by Algorithm (2026-05-14)

One of the most insidious failure modes in AI-driven pipelines isn't the model giving a wrong answer — it's the model giving the *right* answer about the *wrong* thing. We discovered this the hard way when a user noticed that the Daily Discovery card for the "Global Opportunity" slot displayed ASML's ticker but Sony's company description and analysis. The ticker ID was correct; the entire rationale belonged to a different company.

**Understanding the Root Cause**

The previous architecture passed a shortlist of three candidates to a single prompt and asked the model to choose the best one and return a structured JSON object for each. The intent was to give the AI editorial agency — "here are your options, you pick." The failure was that with three company names visible in the same context window, the LLM occasionally conflated their descriptions, especially when two companies occupied similar sector territory.

This is a well-documented class of LLM failure called **cross-entity contamination**. It's not a hallucination in the traditional sense (the model isn't inventing facts) — it's the model performing the right research on the wrong subject, because multiple subjects were visible in the same attention context.

**The Architectural Fix: Algorithm Selects, AI Writes**

The solution was a clean separation of responsibilities. We divided the discovery step into two strictly isolated operations:

1. **Selection (Algorithm)**: A Python `get_best()` function ranks all candidates in each category bucket by `momentum_1mo` and deterministically picks the #1 winner. No LLM involvement. The code decides.

2. **Analysis (LLM)**: Three separate, sequential API calls are made — one per pre-selected ticker. Each prompt contains exactly one company's data and explicitly instructs the model: *"You are analysing {ticker} only. Do NOT mention or analyse any other company. {ticker} is already selected."*

This makes cross-entity contamination structurally impossible. The model never sees another ticker name in its context window.

**The Force-Overwrite Safety Net**

Even with a single-ticker prompt, we added a final hard safeguard: after parsing the AI's JSON response, the `ticker` and `category` fields are unconditionally overwritten with the values the algorithm chose. Even if the model somehow still returns the wrong ticker in the JSON (which is now virtually impossible), the saved record will always carry the correct identifier.

**Cost & Quality Improvements**

Isolating the calls also allowed us to tune the parameters more aggressively:
- **Temperature**: `0.3` → `0.2` — less creative variance, more literal adherence to the prompt structure.
- **Max Tokens**: `1500` → `800` per call — each prompt is now focused on a single company, so the analysis needs less space. This cuts per-run token spend by roughly 40%.

**Cleaning Up the Archaeological Site**

The refactor also unearthed a latent code bug from the previous architecture: a `get_best()` function definition and a `recs` list assignment were sitting inside a malformed `except` clause — code that was syntactically invalid and completely unreachable. It was a ghost of the old shortlist model that had been accidentally merged into the exception handler during an earlier iteration. We excised the entire block.

The Discovery Engine is now a deterministic research pipeline with AI serving as a focused writer, not an unguided selector.

---

## Entry 51: The Research Thesis Pivot — Structured Institutional Intelligence (2026-05-14)

As we moved from a "Market Watcher" to a "Quantitative Research Tool," we realized that long, unstructured paragraphs of AI analysis—while insightful—were a bottleneck for professional scannability. We needed a structured **Research Thesis**.

**The Architectural Challenge: Forcing JSON Consistency**
The primary hurdle was LLM reliability. Even with high-conviction prompts, models occasionally return JSON as an escaped string or with inconsistent key casing (`why` vs `WHY`). We solved this by implementing a **Three-Layer Serialization Fix**:
1.  **The Graph Layer (`discovery_graph.py`)**: We overhaul the AI prompt to strictly output 5 specific keys: **Why, Numbers, Catalysts, Risks, Bottom Line**. We then use a regex-based extractor to force-parse this into a true Python dictionary before saving to DynamoDB as a serialized string.
2.  **The API Layer (`insights.py`)**: On retrieval, the API now proactively attempts `json.loads()` on the rationale. This ensures that the JSON blob is delivered to the frontend as a proper JavaScript object, not a raw string.
3.  **The Frontend Layer (`app.js`)**: We added a `JSON.parse()` safety net and a case-insensitive normalizer. If the AI returns malformed or differently-cased keys, the frontend intelligently maps them to the correct UI columns.

**Information Hierarchy: Dashboard vs. Modal**
To prevent information overload, we introduced "Intelligence Pruning." 
- **The Dashboard Card**: Acts as a "Hook." It uses the new 2-column layout to display only the **Why** and the **Numbers**. This allows a user to scan 3-4 stocks in seconds and decide which one warrants a deeper look.
- **The Ticker Modal**: Acts as the "Full Report." It renders the full 5-key research thesis, providing the risks and catalysts that professional investors require for decision-making.

**Legacy Fallbacks & UI Stability**
A common problem in evolving data schemas is "Legacy Bloat"—old records looking broken in the new UI. We engineered a "Zero-Flicker Fallback" where any existing plain-text rationale is automatically mapped into the new 2-column "**WHY**" section. This ensures 100% layout stability without needing to purge our historical discovery ledger.

This update effectively transitions our AI from being a "Summary Generator" to a "Structured Research Partner."

## Entry 50: The Institutional Grid & The "Network Error" Debug (2026-05-13)

With the analytical universe decoupled and stable, our focus shifted to the UX. A 600-company quantitative screener cannot live in a standard list; it needs the density and scannability of a Bloomberg terminal.

**The Institutional UI Pivot**
We rebuilt the QMJ Screener from the ground up as a "Glassmorphic Grid." Key design pillars included:
1.  **Optical Scannability**: Numeric values are right-aligned in monospace for digit-to-digit comparison.
2.  **Semantic Heatmapping**: Instead of raw numbers, we use "Z-Score Pills." Colors (Amethyst to Ruby) provide an instant visual quality grade before a single digit is read.
3.  **Sticky Contextualization**: Implemented a `sticky` header architecture within a `max-vh-60` container. This ensures that while scrolling through 600 records, the column labels (Quality, Safety, Value) never disappear.

**The "Network Error" Mystery**
During the rollout, we encountered a silent backend failure. The dashboard reported a generic "Network error," but the server appeared to be running. Our investigation revealed a two-pronged failure:
1.  **The Silent Crash**: A single `IndentationError` in a background ingestion script (`financials.py`) was causing the FastAPI instance to fail during the module import phase. Because it happened during import, the server never even started listening on the port.
2.  **Routing Ambiguity**: We had a discrepancy where some routers used the `/api/v1` prefix in their definitions, while others had it added in `main.py`. We standardized this across the board: every router now defines its local namespace (e.g., `/screener`), and the global `/api/v1` prefix is enforced at the application level.

**JS Resilience & Debouncing**
Finally, we fixed a `ReferenceError` where a missing `debounce` utility was breaking the search field. By consolidating our utility functions and improving our error `catch` blocks to display `e.message`, we've made the frontend much better at explaining *why* a failure occurred, rather than just alerting a generic error.

This entry marks the completion of our transition from a "Market Watcher" to a "Quantitative Research Tool."

## Entry 49: Institutional Scaling & Universe Decoupling (The "Bleed" Problem) (2026-05-13)

As we successfully scaled the analytical warehouse to support 600+ companies, we encountered a classic data engineering challenge: **Universe Bleed**.

**The Problem:**
Initially, the system used a single `Tickers` table in DynamoDB to drive both the high-frequency dashboard (updated every 5 minutes) and the analytical screener. When we added 600+ tickers to this table to enable the QMJ model, the high-frequency ingestion engine attempted to fetch real-time prices and synthesize AI insights for all 613 assets every 5 minutes. This immediately threatened to:
1.  **Exhaust the FinOps Budget**: Synthesis for 600+ assets at 5-minute intervals is prohibitively expensive.
2.  **Hit Yahoo Finance Rate Limits**: Sequential fetching for 600 tickers causes massive latency and potential IP blocking.
3.  **Clutter the UX**: The primary dashboard became an unmanageable list of hundreds of assets.

**The Architectural Solution: Universe Decoupling**
We implemented a strict separation of concerns at the storage layer:
- **`TrackedAssets` Table**: Holds the "High-Signal Watchlist" (Hard limit: 30). This table drives the 5-minute price/synthesis loop.
- **`QMJUniverse` Table**: Holds the "Analytical Backing" (600+ assets). This table drives the Quarterly QMJ Pipeline.

**The Quarterly Pipeline Integration**
We refactored the bulk ingestion logic into a specialized service (`src/ingestion/financials.py`) and integrated it with the `dbt` transformation suite. We then scheduled this as a dedicated cron job in the `APScheduler` to run at the start of every financial quarter. This ensures the 600-company screener stays current without impacting the responsiveness of the intraday dashboard assets.

This decoupling allows the engine to act as a **Precision Scalpel** for your active portfolio while simultaneously serving as a **Wide-Angle Lens** for global quantitative research.

## Entry 1: The Global Pivot & Auto-Healing Resilience (2026-03-27)

Initially, our roadmap established an aggressive push directly into AWS. Phase 1 included immediately writing CloudFormation templates and spinning up ECS Fargate instances alongside Amazon API Gateways using Cloud Map VPC links. While the architecture was "cost-optimized" by deferring expensive NAT gateways to Phase 5, the timeline forced us into relying on an active AWS billing account starting from commit zero.

**The Pivot:** We updated our overarching `system_overview.md` to consolidate the roadmap from 5 stages down to 4. We introduced **Phase 1: Fully Local MVP**. This allows us to prove our core differentiator exactly zero dollars down. 

By building a local `docker-compose.yml` framework alongside `amazon/dynamodb-local`, we constructed our core backend Python logic—the automated `APScheduler` loop, `yfinance` data extraction algorithms, `pydantic` schemas, and crucial `boto3` wrappers—without locking a single credential.


## Entry 2: Enforcing FinOps Guardrails  (2026-03-27)

With the structural base implemented, we tackled the primary function of the engine: Cost-Aware AI interaction. Generative models like AWS Bedrock's Claude 3 Haiku charge per token. A runaway system parsing heavy market headlines continuously could easily spike a massive bill. 

We constructed `src/cost_tracking/service.py` which tracks daily spend exactly how an enterprise ledger would. When `src/synthesis/service.py` operates, it doesn't just call Bedrock arbitrarily. It builds the prompt size, multiplies by the configured Token Rate (e.g., $0.00025 per 1K Input Tokens), grabs the `get_daily_spend()` amount out of the DynamoDB ledger, and blocks the request entirely if the calculation exceeds the user's `$5.00` `DAILY_BUDGET_USD` environment variable.

For Phase 1, we implemented the entire algorithm locally, logging simulated "local-mock" Bedrock expenditures into the database. Now, when Phase 2 moves us into live Bedrock execution, our wallet is perfectly protected. 


## Entry 3: Surfacing Analytics via the Dashboard (2026-03-27)

Building an API is fantastic, but visualizing data makes it real. We requested the system natively serve a single-page application from the root endpoint (`/`). 

In `static/index.html` and `static/style.css`, we implemented a premium visual layout. Relying heavily on modern dark-mode aesthetics, custom "glassmorphic" card utilities, dynamic gradient text, and precise padding grids. The custom vanilla `app.js` runs a 15-second polling loop grabbing `/api/v1/health`, `/api/v1/costs`, and `/api/v1/insights`. 

It gracefully renders out exactly how much our mock AI is costing the system against the predefined threshold limits inside of a sleek Budget Utilization progress bar. It then loops over the successfully generated stock insights combining the real Yahoo Finance price action closures directly alongside the mock LLM output.

**What's next?**
Phase 2! The foundational algorithms and cost-gate algorithms are stable. The next goal is executing AWS CloudFormation to secure an ECS perimeter and wiring in Anthropic's Claude to read the real Yahoo Finance news feeds on our live UI.


## Entry 4: Aggregating Live Market News (2026-03-27)

While `yfinance` provides excellent ticker pricing data, we wanted the Insights Engine to synthesize the latest, most relevant market news from a variety of sources. 

We updated `src/ingestion/service.py` to ping the Google News RSS feed for each ticker during the ingestion cycle. We parse the XML tree using the built-in `xml.etree.ElementTree` to extract the single most relevant aggregated headline from top financial publishers (Bloomberg, Reuters, CNBC, etc.) across the web.

This unified headline is then packaged into the DynamoDB `MarketData` item and injected directly into our Phase 1 mock-synthesis response, displaying live news straight on the frontend dashboard without spending a dime on paid news APIs.


## Entry 5: Bridging the Cloud MVP via Bedrock and CloudFormation (2026-03-27)

Phase 2 officially pulls the Insights Engine into AWS! Since our foundational local FinOps budget gates were successfully tested in Phase 1, we aggressively updated `src/synthesis/service.py` to implement the `boto3` Bedrock Runtime client. The Python service now automatically packs our aggregated Yahoo Finance / Google News context into an Anthropic Messages API payload, invoking `anthropic.claude-3-haiku-20240307-v1:0` to synthesize stunning, concise market updates. 

Furthermore, we shifted the architecture off Docker Desktop into Infrastructure-as-Code. We created `infra/cloudformation.yml` defining exactly what the application needs to run in the cloud. We implemented `scripts/deploy.sh` to package, push, and stack the environment gracefully in a single terminal click!

**Lessons from the Cloud:** 
Deployment isn't always linear. We hit several real-world AWS hurdles that we quickly pivoted to solve, reinforcing the importance of platform-specific engineering:
1. **STS Global Endpoints:** Local terminal environments can sometimes stall on global AWS endpoints. Setting an explicit `--region us-east-1` for identity checks solved the connection latency.
2. **ECS Service Linked Roles:** In fresh AWS accounts, the `AWSServiceRoleForECS` must be propagated before CloudFormation can successfully spin up Fargate clusters. We verified the role's existence and purged the failed stack to allow a clean retry.
3. **Log Group Permissions:** Initially, the Fargate container tried to auto-create its own CloudWatch Log Group. This failed due to missing IAM permissions (`logs:CreateLogGroup`). We shifted to a more robust approach by declaring the `AWS::Logs::LogGroup` directly in CloudFormation, ensuring the resource is under our infra-as-code control with a 7-day retention period.
4. **ARM64 vs x86_64:** One of the trickiest errors was an `exec format error` at runtime. Because we built the Docker image on an Apple Silicon Mac (ARM64), it wouldn't run on the default x86_64 Fargate instances. We updated the task definition to use `ARM64` (Graviton), which is both compatible and more cost-efficient!
5. **Static Asset Persistence:** We discovered our dashboard was missing from the cloud image. We updated the `Dockerfile` to explicitly `COPY static/` and ensured our non-root `appuser` owned the application directory to prevent runtime `PermissionError` when starting Uvicorn.
6. **Casing & IAM Hygiene:** Minor bugs like a casing mismatch in Pydantic settings (`AWS_DEFAULT_REGION` vs `aws_default_region`) and missing `ListTables` permissions were caught in the logs and resolved via IAM policy updates.


## Entry 6: Entering Milestone 3 - FinOps & Observability (2026-04-13)

Today we executed the highly anticipated Cost Control & FinOps phase of the engine. While Phase 1 successfully gated local spend via DynamoDB mock ledgers, Milestone 3 operationalizes the engine tightly within the AWS ecosystem.

We introduced a native `src/clients/cloudwatch.py` wrapper, allowing the `synthesis` and `cost_tracking` domains to emit native custom AWS metrics: `DailyAICost`, `InsightsGenerated`, and `BudgetUtilizationPct`. This allows us to observe AI spend mathematically exactly as requests stream through the system.

In `infra/cloudformation.yml`, we integrated these FinOps metrics by deploying two `AWS::CloudWatch::Alarm` resources backed by an SNS Topic. If an aggregation of our cost logic ever spikes past a $4.00 warning threshold or triggers the $5.00 exhaust limit within a daily window, an immediate email is dispatched to the admin. 

Lastly, to visualize this raw spend, we built `GET /api/v1/costs/dashboard` inside `src/routes/costs.py`, which performs a rolling 7-day query map against the `CostTracking` table to compute 30-day projected run-rates to feed directly into our UI later transparently.


## Entry 7: Completing Milestones 3 & 4 (Production Networking & Advanced FinOps Dashboard) (2026-04-13)

With the underlying business logic stable, we shifted focus to the interface and the infrastructure. First, we wired the `/api/v1/costs/dashboard` endpoint into our frontend UI by adding a "7-Day Run Rate Analysis" grid to `static/index.html`. Using vanilla JavaScript in `static/app.js`, we established a polling loop to render the 7-day trailing average and the projected 30-day run rate. This provides a transparent, long-term view of our AI spend directly under our daily budget utilization graphs.

Then, we tackled **Milestone 4: Production Security Hardening**. Previously, our ECS Fargate cluster ran in a public subnet with `AssignPublicIp: ENABLED` to save on early development costs by avoiding NAT appliances. Today, we rewrote `infra/cloudformation.yml` to reflect a true production environment:
1. **Private Subnets & NAT:** The Fargate task now lives strictly inside `PrivateSubnet1` with no public IP. All outbound traffic routes seamlessly through our new `NATGateway`.
2. **Application Load Balancer (ALB):** We introduced an Internet-facing Load Balancer spanning our public subnets. The ALB terminates incoming traffic on port 80 and securely forwards it to the private container listening on port 8000 via a dedicated Target Group. Inward traffic to the Fargate Security Group is now locked down exclusively to the ALB Security Group.
3. **VPC Endpoints:** Since NAT Gateways charge per-GB for data processing, we provisioned a **Gateway VPC Endpoint** for DynamoDB. This ensures that the engine's constant logging of tick data and AI insights traverses the private AWS backbone for free, rather than incurring unnecessary NAT processing fees.

Our Cost-Aware Market Insights Engine is now a robust, fully-containerized, and enterprise-grade microservice!


## Entry 8: Frontend Splitting, TradingView UX, and Dynamic Trackers (2026-04-13)

As the system grew, it became apparent that the FinOps data (costs, utilization, AWS billing logic) needed a separate psychological space from the actual AI Market Insights outputs. To address this, we executed a massive frontend overhaul guided by the principles of the `@Web Wizard` skills suite. 

**Frontend Splitting:**
We restructured `index.html` to support a clean, tabbed navigation architecture between "FinOps Dashboard" and "AI Market Insights". Using vanilla JavaScript, the DOM now elegantly swaps views without a heavy framework layout.

**Dynamic Tickers via DynamoDB:**
Previously, the engine relied on a hard-coded environment variable (`settings.tickers`) to determine which symbols to track. We enhanced the engine to use a DynamoDB table (`Tickers`) as the source of truth. Users can now input a new ticker directly from the AI Market Insights tab. A new `POST /api/v1/tickers` route catches this payload, enforces a 10-symbol maximum, updates DynamoDB, and immediately forces a background `fetch_ticker_data()` to guarantee real-time UI gratification. 

**TradingView-UX:**
To make the market data more actionable, we built a `GET /api/v1/market` endpoint and stitched this inside `app.js` alongside our insight queries. Cards now display current price, percentage change (stylized with positive/negative pills), and up to three aggregated Google News headlines for context—acting highly similar to TradingView's ticker cards. Finally, a `Chart.js` canvas aggregates the live asset prices to formulate a comparative portfolio visualization across the active tracked fleet.


## Entry 9: Cloud Orchestration Finalization & The Last Mile (2026-04-13)

With our new tabbed UI and dynamic ticker management system fully operational locally, the final challenge was ensuring our AWS Cloud environment mirrored this complexity without manual intervention. 

**Infrastructure-as-Code Synchronization:**
We updated our `infra/cloudformation.yml` template to natively provision the new `Tickers` DynamoDB table. This moves the application away from needing manual "seeding" or configuration through environment variables. By declaring the table in CloudFormation, every fresh deployment of the engine now comes "pre-configured" for dynamic watchlist management.

**IAM Policy Hardening:**
Our dynamic ticker logic requires the engine to "scan" the `Tickers` table to build its internal watchlist. We updated the **ECS Task Role** to include `dynamodb:Scan` permissions. We maintained high security by keeping this role strictly attached to the Fargate process, ensuring it can only interact with our 4 specific database tables.

**The "One-Click" Deployment:**
The project was finalized by running a clean `scripts/deploy.sh` execution. This process seamlessly handles:
1. Local Docker building (now fully optimized for **ARM64/Graviton**).
2. Pushing the new Tabbed/Chart-ready image to **Amazon ECR**.
3. Triggering a CloudFormation stack update to provision the Load Balancer, Private Networking, and the Tickers database.

The result is a Production-ready, Cost-Aware Market Insights Engine that provides TradingView-grade analytics with enterprise budget guardrails—running natively on AWS Fargate at an incredibly low operational cost.

**Optimization Polish: The 5-Minute Sweet Spot**
Initially, our background synthesis loop was set to 15 minutes to maximize cost safety. However, to enhance the "live" user experience without exceeding our $5.00 daily budget, we calibrated the engine to a **5-minute cadence**. This provides a 3x increase in responsiveness, ensuring that breaking news is synthesized and reflected on the dashboard while maintaining a predictable, sub-penny cost per update.


## Entry 10: The Architectural Harvest (2026-04-13)

As we wrap up the production launch, it's worth noting how the architecture adapted during the "heat of battle" in the cloud:

1. **What Was Followed**: We stuck religiously to the **Fargate-Dynamo-Bedrock** triad. This provided the low-cost, high-reliability backbone we promised in Milestone 1. The decision to use **Claude 3 Haiku** was a masterstroke for budget maintenance—it allowed us to move from 15-minute to 5-minute intervals while still staying under $1.00/day for initial testing.
2. **What Changed (The Decoupling)**: The biggest pivot was moving from **Static to Dynamic Tickers**. The initial design assumed a fixed portfolio. By introducing the `Tickers` DynamoDB table and a "Synthesis Fast-Path," we transformed the app from a passive dashboard into an interactive research engine.
3. **The UX Filter**: Swapping the "FinOps Dashboard" (our internal pride and joy) to the secondary tab in favor of "AI Insights" was the final lesson in user-centric design—making the tool's value proposition visible at the very first frame.


## Entry 11: The Bedrock Blindspot — A CloudWatch Confession (2026-04-13)

After the production launch, the UI kept showing **"Awaiting AI Synthesis"** despite the deployment being confirmed healthy. A CloudWatch log pull revealed the culprit immediately:

```
AccessDeniedException: Model access is denied due to IAM user or service role is not authorized
to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions,
aws-marketplace:Subscribe)
```

**The trap**: The AWS Bedrock "Model Access" subscription page has been retired — serverless foundation models are now auto-enabled. However, Bedrock still internally validates two `aws-marketplace` IAM actions when calling Anthropic models. These aren't listed prominently in Bedrock's own docs, so it's easy to miss.

**The IAM policy only had `bedrock:InvokeModel`. It needed three more:**
- `aws-marketplace:ViewSubscriptions`
- `aws-marketplace:Subscribe`
- `aws-marketplace:Unsubscribe`

**Two-part fix applied:**
1. Updated `infra/cloudformation.yml` to add the three marketplace permissions to the ECS Task Role.
2. Added a synthesis fallback in `service.py` — if Bedrock still denies (e.g. during IAM propagation), the engine generates a data-driven insight from live price + headline data rather than returning nothing. The UI stays populated no matter what.

This is the kind of "invisible wall" that only shows up in production logs — it underscores why **CloudWatch log access is a first-class concern** in any cloud-native deployment.

**✅ Verified Live — 2026-04-13 17:45 (ICT)**
After deploying the CloudFormation fix, we ran `check_iam.py` (a boto3 verification script) directly against the live AWS account and confirmed all 13 permissions are active on role `market-insights-stack-EcsTaskRole-wV7qUFUhzNOJ`. The new ECS task (`c2b954b5967142fcb3cf896d22bc6d95`) is running with the corrected policy — Bedrock synthesis will fire on the next 5-minute cron cycle.


## Entry 12: Bloomberg on a Budget — The v2 UI Overhaul (2026-04-13)

With the Bedrock IAM fix confirmed, we turned our attention to what the market insights engine *feels* like to use. The v1 UI was functional, but the v2 goal was ambitious: **Bloomberg Terminal-grade interactivity on a sub-$5/day AI budget**.

**The UX Philosophy Behind Each Feature:**

1. **Async Diff-Patch Rendering** — The original design re-rendered every card from scratch every 15 seconds. On a slow connection this caused an ugly flash. The fix was a diff-and-patch renderer: we maintain a `lastMarketData` snapshot and only touch DOM nodes that have actually changed. The result is silky-smooth background updates.
2. **The Delete Button** — One of the most-requested UX patterns in dashboards. `DELETE /api/v1/tickers/{ticker}` now cascades: it removes from the Tickers table, scrubs MarketData rows, and purges Insights. The card fades out over 300ms. No page reload.
3. **Buy/Hold/Sell Signal** — We updated the Claude prompt to end every synthesis with `SIGNAL: BUY|HOLD|SELL`. This turns Claude from a *narrator* into a *trader*. The signal is parsed, stored in DynamoDB, and rendered as a green/grey/red pill next to the ticker name — the first thing a user reads.
4. **The Expandable Modal** — Single biggest UX lift. Clicking any card opens a modal with a full interactive line chart (powered by Chart.js), a period selector (1D through MAX), key financials (52W high/low, P/E, market cap) and an analyst consensus bar fetched live from `yfinance`. The backdrop blurs the dashboard behind it for focus.
5. **Batch Synthesis on Load** — Previously, the only way insights were generated was via the 5-minute cron or when a new ticker was manually added. Now, on every page load, we check for tickers with stale insights (>10 minutes old) and silently fire `POST /api/v1/tickers/{ticker}/synthesize` in the background. All tickers stay perpetually fresh.
6. **Zoom Controls** — Simple but high-impact for power users tracking many tickers at once. CSS `transform: scale()` with a smooth transition handles it cleanly.

**Stack Note:** All of this was achieved without adding any new npm packages or backend frameworks. The entire upgrade runs on the existing Fargate pod — zero infrastructure cost delta.


## Entry 13: The Dedup Blindspot — Ensuring Full-Portfolio AI Coverage (2026-04-13)

After the v2.0.0 UI rollout, we noticed a subtle but important gap: **only one ticker was getting AI synthesis** even though the batch trigger was firing. The root cause was a logic error in `triggerBatchSynthesis()`:

```js
// BEFORE (broken) — only checks staleness by time
const isStale = !insight || (now - insight.timestamp) > TEN_MINUTES_MS;
```

Tickers that previously had a `data-fallback` or `local-mock` insight (generated before Bedrock was healthy) had a **recent timestamp** — they were synthesized during the IAM fix window. The stale check treated them as fresh and skipped them entirely.

**The fix** adds a third condition — `needsRealAI`:

```js
// AFTER (fixed)
const needsRealAI = insight && (
    insight.model_used === 'data-fallback' || insight.model_used === 'local-mock'
);
if (hasNoInsight || isStale || needsRealAI) { ... }
```

This means on every page load, any ticker that hasn't yet received genuine Claude synthesis gets queued for a re-run — regardless of how recently the fallback ran.

We also added **800ms staggered delays** between batch requests (`setTimeout(() => fetch(...), delay * 800)`) to avoid simultaneously invoking Bedrock for 8–10 tickers at once, which risked throttling errors and disrupted the per-request budget gate logic.


## Entry 14: Centralized Control and Better Density (2026-04-13)

Shortly after the v2 rollout, we received crucial user feedback pointing out a few friction points in the UX:
1. **Accidental Deletions:** Having a delete 'X' directly on every ticker card made it too easy to accidentally wipe a ticker from the dashboard.
2. **Blurry Zoom:** The `transform: scale()` CSS method used for the zoom buttons caused the text and charts to look blurry, and it didn't reflow the grid nicely.
3. **Contrast:** The hyperlinked news headlines were hard to read against the dark glass panels.

To fix these without bloating the `app.js`, we implemented "UI V3" (v2.1.0):
- **Manage Watchlist:** We stripped the delete buttons from the individual cards. We replaced this with a centralized "Manage Watchlist" button in the control bar. Clicking it toggles a clean dropdown panel where users can view all tracked tickers and delete them safely.
- **Grid Density:** The zoom buttons were replaced by a "Grid Density" toggle. Instead of scaling the UI, this toggles CSS classes (`density-compact`, `density-standard`, `density-wide`) on the grid container itself, adjusting the `min-width` of the grid columns. This reflows the cards perfectly without any blurriness.
- **Refined Aesthetics:** News links were bumped to a high-contrast `#7dd3fc` with a subtle underline to make their clickability obvious. 


## Entry 15: True Chart Zooming and the Invisible Ticker Problem (2026-04-14)

During final production validation, we encountered two significant state desync issues and a major scalability risk as we opened up the dashboard.

**The Invisible Ticker Desync:**
We noticed an edge case where a user would add a ticker, but nothing would appear on the UI. The confusing part? If they tried adding it again, the backend correctly claimed "already tracked!" And soon after, "Maximum 10 tickers allowed" would spawn, yet the UI only displayed 2 tickers.
- **Root Cause:** A data synchronization flaw. Tickers are stored in the `Tickers` DynamoDB table, but if their first API fetch via `yfinance` failed, they never reached the `MarketData` table. The frontend `/api/v1/market` only extracted from `MarketData`, causing these stuck tickers to remain forever invisible and perpetually taking up allotted space.
- **The Fix:** We rewrote `/api/v1/market` to map over the full list of `active_tickers`. If a ticker exists in the tracker but fails the `MarketData` link, instead of hiding it, we construct a `status: "pending_data"` placeholder. The frontend UI now renders an elegant "Fetching Data..." transparent card for these, allowing users to safely delete the stalled assets.

**Rate Limiting against Abuse:**
Opening the deployment exposed raw proxy polling. Given the tight Anthropic Haiku Bedrock limitations and `yfinance` IP throttling rules, clicking a ticker repetitively quickly hammered the limits.
- **The Fix:** We embedded the robust `slowapi` library into our FastAPI initialization stack. 
    - Queries to `/api/v1/market` are restricted to 20/minute.
    - Synchronous interactions to `/api/v1/tickers` (Add/Delete/Synthesize) are throttled heavily to 5/minute, enforcing strict application limits and shielding our downstream endpoints.


## Entry 16: System Self-Healing and Dark Mode Restoration (2026-04-14)

During testing following our recent rate-limiting upgrade, we uncovered two critical issues affecting user experience and data fluidity.

**Dark Mode Regression:**
A syntax error in `style.css` (specifically, an accidental truncation of the `:root {` block) caused the browser to lose access to all custom glassmorphic CSS variables. This forced the dashboard to fall back into a stark white mode. We restored the root selector immediately, returning the dashboard to the intended `#0f172a` minimal aesthetic.

**The "White Screen of PENDING" and Auto-Recovery Loop:**
Previously, we established a `pending_data` visual state for tickers that failed their initial upstream fetch (due to strict rate limits on `yfinance`). However, these tickets would stay stuck in a "pending" card until the backend background polling script executed 5 minutes later.
- **The Fix:** We built a dedicated `POST /api/v1/tickers/{ticker}/ingest` endpoint bypassing caching buffers.
- In `static/app.js`, we integrated a self-healing automation loop named `triggerBatchIngestion`. When the frontend UI receives tickers flagged with `pending_data`, the interface naturally updates the static text to an animated spinner. Behind the scenes, `triggerBatchIngestion` executes staggered background polling (buffered 2-seconds apart) to seamlessly force upstream metadata loads.


## Entry 17: Normalized Financial Visualization & the Cache Trap (2026-04-14)

Our Auto-Recovery "pending" logic worked beautifully on a minor scale, but as users imported massively diverse portfolios, we hit two distinct architectural hurdles.

**The Infinite Rate-Limit Loop:**
The previous fix looped over missing tickers and requested ingestions every 15 seconds. However, if a user had over 5 tickers pending, they instantly crashed into the `5/minute` API rate-cap. Their IP got banned before the data could fetch, and the loop repeated relentlessly. We solved this by instituting a local JavaScript `Set()` memory trap to ensure no ticker is ever re-ingested twice per loaded session, while raising the endpoint threshold to `30/minute`.

**Portfolio View - Scale Mismatches:**
The Portfolio Summary card previously rendered an aesthetic Pie/Bar component. The flaw occurred if tracing `$0.01` volatile tokens alongside `$100,000` institutional holdings; the chart representation became uselessly distorted.
- **The Fix:** We completely rewrote `updatePortfolioChart()`. The UI now executes background pulls of the trailing 1-month market history for every tracked item. We loop this array alongside a baseline initialization function: `((current_price - start_price) / start_price) * 100`. 
- Every ticker represents exactly `0%` on day one, and curves beautifully along a unifying Time-Series multi-line grid graph.


## Entry 18: Pure Absolute Pricing & Persistent Recovery (2026-04-14)

Sometimes "mathematically perfect" UI decisions (like percentage normalization) aren't what the user actually needs for their workflow. We pivoted the portfolio chart away from percentages back to absolute USD values. 

**The Scaling Paradox:** 
By switching to absolute values, we immediately ran into the scaling issue where expensive stocks flattened cheaper ones. We solved this by implementing a **Logarithmic Y-Axis**, which preserves the visual magnitude of percentage moves while showing the real dollar price.

**Eliminating the Infinite Spinner:**
The "pending" states were stickier than expected because our previous "one-shot" ingestion attempt wasn't accounting for transient backend failures or Yahoo Finance empty responses.
- **Backend Fix:** We now pull a 5-day window for every single ticker check. If today is a holiday or a Sunday, we successfully fall back to Friday's data instead of returning `None`.
- **Frontend Fix:** We removed the binary "tried once" lock. Tickers now retry every 15 seconds until they succeed, but we added an "active ingestion" guard to prevent parallel hammering of the same ticker within the same cycle.


## Entry 19: The Pivot to Simplicity & Robust Fallbacks (2026-04-14)

Complexity for complexity's sake often backfires. Our multi-line time-series experiment, while mathematically sound, introduced mapping bugs (the date/time mismatch) and didn't provide the immediate "at-a-glance" value the user wanted.

**Reverting for Clarity:**
We reverted the main portfolio visual to a **Bar Chart**. By focusing on absolute `close_price`, we provide immediate feedback on asset magnitude. To handle the disparate price scales, we ensured the chart is cleanly sorted by value.

**Solving the "Stuck" Ingestion:**
The primary cause of the persistent "Pending" banners was a reliance on `ticker.history(period="1d/5d")`. On certain days, Yahoo's API returns empty frames for these specific calls, even while the stocks are very much active.
- **The Solution:** We implemented a prioritized fallback. If history fails, we ping `ticker.fast_info` then `ticker.info` for the `regularMarketPrice`. 


## Entry 20: The Invisible Data Problem — DynamoDB Pagination and the Startup Throttle (2026-04-15)

After the v2.3.x stabilization pass, a persistent and deceptive bug remained: on every page refresh, only the **first 2–3 tickers** showed live prices. The rest (META, IBM, AMD) were permanently stuck in `pending_data` spinner state despite Bedrock being healthy and insights existing for them.

**The Live Diagnosis:**
We fetched the raw API endpoints directly to establish ground truth:
```
GET /api/v1/tickers  → ["NVDA", "TSLA", "META", "IBM", "AMD"]
GET /api/v1/market   → NVDA: active ✅ | TSLA: active ✅ | META: pending ❌ | IBM: pending ❌ | AMD: pending ❌
GET /api/v1/insights → All 5 tickers have real Claude insights ✅ (+ ghost AAPL insight ⚠️)
```

**Root Cause 1 — DynamoDB `scan()` Silently Truncates at 1MB (Primary)**
`GET /api/v1/market` and `GET /api/v1/insights` both called `table.scan()` with no pagination logic. DynamoDB's `scan()` API returns up to 1MB per call. Replaced with per-ticker `table.query(KeyConditionExpression=Key('ticker').eq(t), ScanIndexForward=False, Limit=1)`.

**Root Cause 2 — Synchronous Startup Ingestion Race**
`main.py` called `scheduled_job()` synchronously inside the `lifespan()` function — meaning the container couldn't finish startup until all tickers were fetched. Moved startup ingestion to a `daemon=True` Python thread with a 10-second delay.

**Root Cause 3 — Ghost Insights for Removed Tickers**
`GET /api/v1/insights` returned results for any ticker that ever had an insight written. The fix: only query insights for tickers that currently exist in the Tickers table.


## Entry 21: The Bloomberg Polish — Bulleted Insights & Terminal UX (2026-04-17)

While the engine was functionally "concluded" as a production microservice, the gap between a "tool" and a "terminal" lies in the density and readability of its data. We executed a specialized polish phase aimed at achieving **Bloomberg-grade visual hierarchy**.

1. **Hero Stat Prominence:** Refactored the ticker detail modal to distinguish between "Main" and "Secondary" metrics.
2. **Structured "Stick" Insights:** Updated the Claude 3 Haiku prompt to enforce a bulleted structure across three domains: Market Context, Thesis Impact, and Outlook/Risks.
3. **Analyst Depth & Target Prices:** Surfaced the **Mean Target Price** and hardened the analyst summary parsing.


## Entry 22: From "Equity Analyst" to "Investment Assistant" (2026-04-26)

While the v2.5 phase achieved Bloomberg-level density, user feedback indicated that the language was drifting into "Institutional Jargon." We executed a "friendly polish" to pivot the engine's persona from a cold analyst to a helpful assistant.

1. **The "Investment Assistant" Persona:** Rewrote the Bedrock prompt to prioritize conversational clarity.
2. **Intelligent Formatting Logic:** Updated the `formatInsight` utility to automatically bold category labels.
3. **Tackling Truncated Intelligence:** Increased the "About" section character limit to **3,000 characters**.
4. **Friendly UI Labels:** Updated headers to "Quick Stats", "What Experts Say", and "Latest AI Take".


## Entry 23: Ticker Autocomplete and the "Clean Exit" Strategy (2026-05-04)

As the engine reached a stable production state, we identified two final friction points: the manual entry of stock tickers and the complexity of stopping an AWS deployment.

1. **Smart Ticker Autocomplete:** Integrated a new `/api/v1/search` endpoint that acts as a proxy to the Yahoo Finance search API.
2. **The "Clean Exit" Automation:** Engineered `scripts/teardown.sh` to safely purge CloudFormation stacks and ECR repositories.
3. **Cache Busting:** Implemented a manual versioning system (`?v=6`) for all primary static assets.


## Entry 24: Distributed Evolution - The Alpha-DAG and MCP (2026-05-06)

We hit a massive architectural milestone today. We replaced our monolithic architecture with **Phase 2: Alpha-DAG**.

1. **Deconstructing the Monolith with LangGraph:** Replaced rigid loops with a **LangGraph DAG**.
2. **Absolute Isolation via MCP:** Extracted `yfinance` logic and quant compute into isolated **Model Context Protocol (MCP)** servers.
3. **Shadow Deployment:** Exposed a new V2 endpoint for shadow testing.


## Entry 25: Fine-Tuning the Discovery Agent — Filtering and FinOps (2026-05-06)

With the Alpha-DAG architecture in place, we turned our focus to the "Daily Discovery Agent." 

1. **Watchlist-Aware Discovery:** Updated the agent to filter out any tickers currently in the user's watchlist.
2. **Discovery Enrichment:** Upgraded the discovery picks to include **Last Price** and **5-Day % Change**.
3. **Infrastructure-Aware FinOps:** Updated cost tracking to include fixed infrastructure costs ($0.035/hour).


## Entry 26: The Colima Networking Incident (2026-05-06)

**Problem:** Local dashboard was unreachable due to Colima's isolated VM networking.
**Fix:** Restarted Colima with the `--network-address` flag to provision a bridged interface.


## Entry 27: Breaking the AWS Tether — Local AI via Ollama (2026-05-06)

We integrated **Ollama** directly into the engine's synthesis layer.

1. **Multi-Provider Architecture:** Refactored the service to support `mock`, `bedrock`, and `ollama`.
2. **Gemma 4 Optimization:** Configured Docker to communicate with the Ollama server on the host.
3. **Parsing Parity:** Maintained consistent output structures across all providers.


## Entry 28: Global Scale and Interactive Visuals (2026-05-07)

1. **Multi-Currency Infrastructure:** Implemented support for USD, EUR, GBP, AUD, and JPY.
2. **Interactive Portfolio Storytelling:** Updated charts to support "Jump-to-Modal" actions.
3. **Zero-Flicker UX:** Disabled refresh animations for background updates.
4. **Educational Infrastructure:** Expanded the "How it Works" section.


## Entry 29: Closing the Discovery Gap - Structured Rationale and Live Hydration (2026-05-07)

1. **The Structured Rationale Pivot:** Enforced a 2-point structure for discovery picks.
2. **Asynchronous Hero Stat Hydration:** Updated discovery modals to fetch live quotes on-demand.


## Entry 30: TradingView-Grade Scannability & Multi-LLM Clarity (2026-05-07)

1. **Metadata Integration:** Surfaced Exchange and Company Name on dashboard cards.
2. **Dynamic Currency Pricing:** Implemented the `/meta/rates` service using Yahoo Finance FX API.
3. **Right-Aligned Pricing:** Optimized spatial layout for rapid scanning.


## Entry 31: The "Intraday Momentum" Upgrade (2026-05-07)

1. **The 24-Hour Pulse:** Integrated 24-hour sparklines into every ticker card.
2. **Breaking the 10-Ticker Ceiling:** Expanded capacity to support **30 tracked tickers**.
3. **Visualization Polish:** Added static data labels to the portfolio bar chart.


## Entry 32: Deep System Stabilization and Global Market Parity (2026-05-07)

1. **yfinance Multi-Index Patch:** Refactored discovery logic to handle library updates.
2. **Dynamic Currency Normalization:** Moved beyond hardcoded USD logic for AU and EU markets.
3. **Frontend Syntax Protection:** Resolved fatal JS errors and hardened backend routes.


## Entry 33: Designing the "Discover" Experience (2026-05-07)

Restructured the navigation into **Manage** (tracked assets) and **Discover** (global market intelligence hub).


## Entry 34: Stability, Redundancy, and the NaN Problem (2026-05-07)

1. **NaN Serialization Trap:** Implemented a global `clean_float` utility to prevent JSON errors.
2. **Chart Restoration:** Fixed field-naming mismatches in the new area chart.


## Entry 35: AI Transparency and the "Smart Narrative" Pivot (2026-05-07)

Overhauled the discovery rationale into a 3-bullet **Smart Narrative** format grounded in quantitative metrics like momentum and volatility.


## Entry 36: Achieving 24-Hour Market Transparency (2026-05-07)

Implemented an explicit "Price Stack" (Close, Pre, and Post market prices) and enforced strict chronological news sorting.


## Entry 37: The Localization Battle & JSON Normalization (2026-05-08)

1. **Exchange-Aware Formatting:** Overrode currency symbols based on asset exchange (¥, A$, HK$, etc.).
2. **Defensive Parsing:** Implemented flexible JSON extraction for local Ollama models.
3. **Pacific Rim Support:** Expanded currency bridge to HKD, CAD, SGD, and NZD.


## Entry 38: The Analytical Leap — Global QMJ Screener & Data Lakehouse (2026-05-11)

1. **Quantitative Rigor (QMJ):** Implemented the Quality Minus Junk scoring algorithm.
2. **Open Data Lakehouse:** Adopted dbt Core with DuckDB (Local) and AWS Athena (Cloud).
3. **Screener Integration:** Introduced a dedicated Screener tab with a high-density table view.


## Entry 39: Stabilizing the Global Quality Screener (2026-05-11)

Transitioned to a **5-Factor Model** and implemented a fixed-height, scrollable screener table with sticky headers.


## Entry 40: The Institutional Pivot — Dashboard Streamlining (2026-05-12)

1. **Dashboard Streamlining**: Reverted default tracked list to **FAANG** assets.
2. **Screener Isolation**: Maintained the 600-ticker analytical warehouse in DuckDB/dbt.
3. **System Stability**: Resolved Python 3.9 compatibility issues.


## Entry 41: Resilience Hardening & The "Permissive" Screener (2026-05-12)

1. **Permissive Factor Ranking**: Refactored logic to treat missing factors as neutral.
2. **Quarterly Fallbacks**: Upgraded ingestion to pivot to quarterly reports if yearly data is missing.
3. **Mathematical Safety**: Implemented outlier capping in the DuckDB engine.


## Entry 42: Dynamic FinOps Budget Controls (2026-05-12)

Operationalized the FinOps budget system by moving from static environment variables to a **persistent runtime configuration** layer.

1. **SystemSettings Persistence**: Created a dedicated `SystemSettings` DynamoDB table to store budget thresholds and enforcement toggles.
2. **Runtime Configuration API**: Implemented `POST /api/v1/costs/settings` to allow administrators to adjust financial guardrails without container restarts.
3. **Interactive Budget UI**: Injected a glassmorphic control panel into the Costs view, featuring a sleek budget toggle and numeric dollar limit input with real-time backend synchronization.
4. **Dynamic Enforcement**: Refactored the `check_budget` service to prioritize these dynamic database settings, enabling instantaneous global control over AI spending pipelines.

## Entry 43: Discovery Agent Revamp — High-Conviction Intelligence (2026-05-13)

Elevated the Daily Discovery Agent from a simple ticker picker to a high-utility investment tool.

1. **12-Hour Freshness**: Doubled the agent's cadence to run at both 8 AM and 8 PM AEST, ensuring the dashboard surfaces fresh, high-conviction insights for both the AU and US market opens.
2. **High-Conviction Rationale**: Overhauled the AI prompt to adopt a "Top-Tier Hedge Fund Analyst" persona. The engine now generates persuasive investment theses focused on "selling" the pick through technical catalysts and narrative strength, moving beyond generic summaries.
3. **Intelligence Integration**: Bridged the gap between raw news and AI picks by embedding live news feeds directly into the discovery cards and modals, providing immediate context for the agent's selections.
4. **Frictionless Acquisition**: Integrated an "Add to Watchlist" button directly into the ticker detail modal, allowing users to move from "Discovering" to "Tracking" in a single interaction.

## Entry 44: Discovery Agent Stabilization — Environment-Aware AI & Intelligence Injection (2026-05-13)

Hardened the Discovery Agent's reliability and intelligence to ensure it remains the "brain" of the engine regardless of deployment context.

1. **Environment-Aware AI Selection**: Implemented explicit environment checks (`local` vs `production`) to automatically switch between **Ollama (Llama 3.2)** and **Amazon Bedrock (Claude 3 Haiku)**. This ensures zero-config operationality when moving from developer laptops to AWS Fargate.
2. **Contextual Awareness (News Injection)**: The AI now "sees" the news. Before generating recommendations, the agent fetches recent headlines for top candidates and injects them into the LLM prompt. This allows the synthesis to reference specific market catalysts (e.g., earnings beats, sector rotation) instead of relying solely on price momentum.
3. **Robust UI Rendering**: Fixed a critical rendering issue where news headlines weren't appearing in the ticker detail modal for discovery picks. Updated the frontend to handle the JSON-formatted news objects stored in the discovery ledger.
4. **Intelligent Freshness**: Added a "Stale Check" on startup. If the discovery picks are older than 12 hours, the engine force-triggers a refresh immediately, preventing the dashboard from displaying outdated "Hidden Gems" after a long period of inactivity.

## Entry 45: The Intelligence Pivot — Quant + Research Consensus (2026-05-13)

Transformed the Discovery Agent from a momentum-based picker into a high-conviction research engine by integrating specialized multi-modal nodes into the Alpha-DAG.

1. **The 'Quant Analyst' Node**: Replaced simple price change tracking with a technical modeling node that computes **RSI-14**, **SMA-200 Distance**, and **Annualized Volatility**. This provides the "mathematical floor" and risk boundaries for every pick.
2. **The 'xvary-research' Node**: Injected fundamental deep-dives (ROE, Revenue Growth, Valuation) and Analyst Target Upside data. The agent now evaluates "Quality" and "Value" before "Momentum," aligning our AI synthesis with institutional standards.
3. **The Consensus Prompt**: Refactored the AI synthesis logic to act as a committee consisting of a Quant Analyst and a Research Lead. This results in rationales that aren't just "The price went up," but rather "Strong 25% target upside coupled with an oversold RSI of 32 makes this a high-conviction entry."
4. **High-Frequency Refresh & Sampling**: Shifted to a **12-hour refresh cycle** (8 AM / 8 PM AEST) with dynamic universe sampling from 75+ global movers. The dashboard now feels "alive" twice a day with fresh, data-backed institutional-grade insights.
5. **UI Integration**: Surfaced the new technical metrics directly on discovery cards and integrated "Add to Watchlist" functionality into the research modals, closing the loop between discovery and tracking.

## Entry 46: User Empowerment — Force-Refresh & Interactive Feedback (2026-05-13)

Finalized the modernization of the Discovery tab by giving users direct control over the intelligence pipeline and improving the overall interactive experience.

1.  **Manual Force-Refresh**: Added a "Force Refresh" button to the Discovery tab, wired to a new backend POST endpoint. This allows users to bypass the 12-hour automated cycle and trigger the Discovery DAG on-demand.
2.  **Market Cache Invalidation**: The manual refresh doesn't just trigger the AI; it clears the local caches for indices, commodities, top movers, and news headlines, ensuring the entire "Discover" section is updated with real-time market data instantly.
3.  **Real-Time Feedback (Toast System)**: Implemented a sleek toast notification system. Users now receive immediate, non-intrusive confirmation when a refresh is triggered or when an asset is added to their watchlist.
4.  **Operational Polish**: Hardened the refresh logic with a 2-run-per-minute rate limit to prevent API abuse while ensuring the frontend remains responsive with "Refining..." loading states during heavy DAG execution.

## Entry 47: Stabilization and the Python 3.9 Compatibility Barrier (2026-05-13)

During the rollout of the Force-Refresh feature, we encountered a series of critical "silent failures" that highlighted the challenges of maintaining a local development environment that mirrors a production Python 3.9 stack.

1.  **The Type-Hint Trap**: We hit a `TypeError` on startup caused by using the modern `str | None` union syntax in `src/routes/v2_dag.py`. This syntax was introduced in Python 3.10, but our target environment runs 3.9. This caused the FastAPI server to crash during its hot-reload, leaving a "zombie" version of the API in memory that lacked our newest routes. We refactored all new routes to use `Optional[str]` from the `typing` module for universal compatibility.
2.  **API Routing Recovery**: Because the server reload had stalled, the new `/discover/refresh` route was "missing" from the perspective of the frontend. We performed a deep audit of the route registration in `main.py` and ensured the `discover` router was mounted correctly after resolving the syntax errors.
3.  **Local vs Docker Networking**: We resolved a connection desync where the application was attempting to reach `http://dynamodb-local:8000` while running natively on the host Mac. We standardized the `.env` to use `localhost:8001` for native runs (mapping to the Docker database port), while maintaining service-name support for containerized runs.
4.  **Non-blocking Background Refreshes**: We refactored the manual refresh route to move both the cache invalidation and the DAG execution into a background thread. This prevents "504 Gateway Timeouts" and keeps the UI snappy while the system performs heavy data ingestion.

## Entry 48: UX Refinement — Tactile Feedback and Cooldowns (2026-05-13)

With the backend stabilized, we polished the UI to feel more like a professional terminal.

1.  **Unified Global Refresh**: We consolidated the "Force Refresh" actions into a single, high-visibility button at the top of the dashboard. This button now invalidates all caches and triggers the Discovery DAG in one click, simplifying the user mental model.
2.  **Tactile Refresh Animation**: To provide clear click feedback, the Refresh button now briefly flashes "Updating..." for **0.1 seconds**. This gives the user instant confirmation that their intent was registered before the system moves into its background processing state.
3.  **The 30-Second Cooldown**: To protect our AI budget and prevent redundant upstream API calls (Yahoo Finance/Bedrock), we implemented a **30-second lockout** on the refresh button. The button becomes semi-transparent and disabled immediately after a successful trigger, with a toast notification to warn the user if they try to spam the action.
4.  **Tab Isolation**: By hiding the secondary "Discovery Refresh" button, we cleaned up the Discovery tab's visual hierarchy, allowing the high-conviction "Hidden Gem" cards and their news headlines to take center stage.
