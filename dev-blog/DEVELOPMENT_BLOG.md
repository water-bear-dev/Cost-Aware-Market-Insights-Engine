# Development Blog

A working document detailing engineering decisions, feature updates, and architectural pivots as the Cost-Aware Market Insights Engine evolves.

## Entry 39: Stabilizing the Global Quality Screener

*Date: 2026-05-11*

With the dbt pipeline established, our final push for Phase 8 focused on stabilization and analytical depth. We transitioned from a simple 2-factor QMJ proxy to a comprehensive **5-Factor Model**, incorporating Profitability, Growth, Safety, Valuation, and Momentum.

**Engineering the Fallback:**
We encountered a scenario where the dbt models might not have processed the latest ingested data (e.g., between scheduled runs). To solve this, we updated `WarehouseClient` with a defensive fallback layer. If a query requests Z-scores that aren't yet in the database, the client performs a high-performance **Pandas-based Z-score calculation** on the fly. This ensures the UI is never "stale" or missing metrics.

**UI Scalability & The Scroll Trap:**
As we added the ASX universe alongside the S&P 500, the screener table became massive. To preserve the TradingView-grade experience, we refactored the viewport into a **fixed-height, scrollable container** with **sticky headers**. This allows users to browse hundreds of high-quality assets while keeping the factor labels in view at all times.

**Universe Unification:**
We implemented an "All Universes" toggle, allowing for the first time a direct relative ranking of US vs. AU assets. By normalizing the Z-score calculation across the entire active dataset, the engine now surfaces the true global "Quality" outliers, fulfilling the Phase 8 objective of a robust, globalized analytical engine.

## Entry 1: Shifting gears to the Local MVP

*Date: 2026-03-27*

Initially, our roadmap established an aggressive push directly into AWS. Phase 1 included immediately writing CloudFormation templates and spinning up ECS Fargate instances alongside Amazon API Gateways using Cloud Map VPC links. While the architecture was "cost-optimized" by deferring expensive NAT gateways to Phase 5, the timeline forced us into relying on an active AWS billing account starting from commit zero.

**The Pivot:** We updated our overarching `system_overview.md` to consolidate the roadmap from 5 stages down to 4. We introduced **Phase 1: Fully Local MVP**. This allows us to prove our core differentiator exactly zero dollars down. 

By building a local `docker-compose.yml` framework alongside `amazon/dynamodb-local`, we constructed our core backend Python logic—the automated `APScheduler` loop, `yfinance` data extraction algorithms, `pydantic` schemas, and crucial `boto3` wrappers—without locking a single credential.

## Entry 2: Enforcing FinOps Guardrails 

*Date: 2026-03-27*

With the structural base implemented, we tackled the primary function of the engine: Cost-Aware AI interaction. Generative models like AWS Bedrock's Claude 3 Haiku charge per token. A runaway system parsing heavy market headlines continuously could easily spike a massive bill. 

We constructed `src/cost_tracking/service.py` which tracks daily spend exactly how an enterprise ledger would. When `src/synthesis/service.py` operates, it doesn't just call Bedrock arbitrarily. It builds the prompt size, multiplies by the configured Token Rate (e.g., $0.00025 per 1K Input Tokens), grabs the `get_daily_spend()` amount out of the DynamoDB ledger, and blocks the request entirely if the calculation exceeds the user's `$5.00` `DAILY_BUDGET_USD` environment variable.

For Phase 1, we implemented the entire algorithm locally, logging simulated "local-mock" Bedrock expenditures into the database. Now, when Phase 2 moves us into live Bedrock execution, our wallet is perfectly protected. 

## Entry 3: Surfacing Analytics via the Dashboard

*Date: 2026-03-27*

Building an API is fantastic, but visualizing data makes it real. We requested the system natively serve a single-page application from the root endpoint (`/`). 

In `static/index.html` and `static/style.css`, we implemented a premium visual layout. Relying heavily on modern dark-mode aesthetics, custom "glassmorphic" card utilities, dynamic gradient text, and precise padding grids. The custom vanilla `app.js` runs a 15-second polling loop grabbing `/api/v1/health`, `/api/v1/costs`, and `/api/v1/insights`. 

It gracefully renders out exactly how much our mock AI is costing the system against the predefined threshold limits inside of a sleek Budget Utilization progress bar. It then loops over the successfully generated stock insights combining the real Yahoo Finance price action closures directly alongside the mock LLM output.

**What's next?**
Phase 2! The foundational algorithms and cost-gate algorithms are stable. The next goal is executing AWS CloudFormation to secure an ECS perimeter and wiring in Anthropic's Claude to read the real Yahoo Finance news feeds on our live UI.

## Entry 4: Aggregating Live Market News

*Date: 2026-03-27*

While `yfinance` provides excellent ticker pricing data, we wanted the Insights Engine to synthesize the latest, most relevant market news from a variety of sources. 

We updated `src/ingestion/service.py` to ping the Google News RSS feed for each ticker during the ingestion cycle. We parse the XML tree using the built-in `xml.etree.ElementTree` to extract the single most relevant aggregated headline from top financial publishers (Bloomberg, Reuters, CNBC, etc.) across the web.

This unified headline is then packaged into the DynamoDB `MarketData` item and injected directly into our Phase 1 mock-synthesis response, displaying live news straight on the frontend dashboard without spending a dime on paid news APIs.

## Entry 5: Bridging the Cloud MVP via Bedrock and CloudFormation

*Date: 2026-03-27*

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

## Entry 6: Entering Milestone 3 - FinOps & Observability

*Date: 2026-04-13*

Today we executed the highly anticipated Cost Control & FinOps phase of the engine. While Phase 1 successfully gated local spend via DynamoDB mock ledgers, Milestone 3 operationalizes the engine tightly within the AWS ecosystem.

We introduced a native `src/clients/cloudwatch.py` wrapper, allowing the `synthesis` and `cost_tracking` domains to emit native custom AWS metrics: `DailyAICost`, `InsightsGenerated`, and `BudgetUtilizationPct`. This allows us to observe AI spend mathematically exactly as requests stream through the system.

In `infra/cloudformation.yml`, we integrated these FinOps metrics by deploying two `AWS::CloudWatch::Alarm` resources backed by an SNS Topic. If an aggregation of our cost logic ever spikes past a $4.00 warning threshold or triggers the $5.00 exhaust limit within a daily window, an immediate email is dispatched to the admin. 

Lastly, to visualize this raw spend, we built `GET /api/v1/costs/dashboard` inside `src/routes/costs.py`, which performs a rolling 7-day query map against the `CostTracking` table to compute 30-day projected run-rates to feed directly into our UI later transparently.

## Entry 7: Completing Milestones 3 & 4 (Production Networking & Advanced FinOps Dashboard)

*Date: 2026-04-13*

With the underlying business logic stable, we shifted focus to the interface and the infrastructure. First, we wired the `/api/v1/costs/dashboard` endpoint into our frontend UI by adding a "7-Day Run Rate Analysis" grid to `static/index.html`. Using vanilla JavaScript in `static/app.js`, we established a polling loop to render the 7-day trailing average and the projected 30-day run rate. This provides a transparent, long-term view of our AI spend directly under our daily budget utilization graphs.

Then, we tackled **Milestone 4: Production Security Hardening**. Previously, our ECS Fargate cluster ran in a public subnet with `AssignPublicIp: ENABLED` to save on early development costs by avoiding NAT appliances. Today, we rewrote `infra/cloudformation.yml` to reflect a true production environment:
1. **Private Subnets & NAT:** The Fargate task now lives strictly inside `PrivateSubnet1` with no public IP. All outbound traffic routes seamlessly through our new `NATGateway`.
2. **Application Load Balancer (ALB):** We introduced an Internet-facing Load Balancer spanning our public subnets. The ALB terminates incoming traffic on port 80 and securely forwards it to the private container listening on port 8000 via a dedicated Target Group. Inward traffic to the Fargate Security Group is now locked down exclusively to the ALB Security Group.
3. **VPC Endpoints:** Since NAT Gateways charge per-GB for data processing, we provisioned a **Gateway VPC Endpoint** for DynamoDB. This ensures that the engine's constant logging of tick data and AI insights traverses the private AWS backbone for free, rather than incurring unnecessary NAT processing fees.

Our Cost-Aware Market Insights Engine is now a robust, fully-containerized, and enterprise-grade microservice!

## Entry 8: Frontend Splitting, TradingView UX, and Dynamic Trackers

*Date: 2026-04-13*

As the system grew, it became apparent that the FinOps data (costs, utilization, AWS billing logic) needed a separate psychological space from the actual AI Market Insights outputs. To address this, we executed a massive frontend overhaul guided by the principles of the `@Web Wizard` skills suite. 

**Frontend Splitting:**
We restructured `index.html` to support a clean, tabbed navigation architecture between "FinOps Dashboard" and "AI Market Insights". Using vanilla JavaScript, the DOM now elegantly swaps views without a heavy framework layout.

**Dynamic Tickers via DynamoDB:**
Previously, the engine relied on a hard-coded environment variable (`settings.tickers`) to determine which symbols to track. We enhanced the engine to use a DynamoDB table (`Tickers`) as the source of truth. Users can now input a new ticker directly from the AI Market Insights tab. A new `POST /api/v1/tickers` route catches this payload, enforces a 10-symbol maximum, updates DynamoDB, and immediately forces a background `fetch_ticker_data()` to guarantee real-time UI gratification. 

**TradingView-UX:**
To make the market data more actionable, we built a `GET /api/v1/market` endpoint and stitched this inside `app.js` alongside our insight queries. Cards now display current price, percentage change (stylized with positive/negative pills), and up to three aggregated Google News headlines for context—acting highly similar to TradingView's ticker cards. Finally, a `Chart.js` canvas aggregates the live asset prices to formulate a comparative portfolio visualization across the active tracked fleet.

## Entry 9: Cloud Orchestration Finalization & The Last Mile

*Date: 2026-04-13*

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

**Project Milestone: Production Launch Ready**
With dynamic ticker management, real-time AI cross-synthesis, and automated cloud CI/CD now fully operational, the project has reached its target "Golden State." The engine is not just an insights tool—it is a study in lean cloud architecture and defensive FinOps engineering. 

### Entry 10: The Architectural Harvest
*Date: 2026-04-13*

As we wrap up the production launch, it's worth noting how the architecture adapted during the "heat of battle" in the cloud:

1. **What Was Followed**: We stuck religiously to the **Fargate-Dynamo-Bedrock** triad. This provided the low-cost, high-reliability backbone we promised in Milestone 1. The decision to use **Claude 3 Haiku** was a masterstroke for budget maintenance—it allowed us to move from 15-minute to 5-minute intervals while still staying under $1.00/day for initial testing.
2. **What Changed (The Decoupling)**: The biggest pivot was moving from **Static to Dynamic Tickers**. The initial design assumed a fixed portfolio. By introducing the `Tickers` DynamoDB table and a "Synthesis Fast-Path," we transformed the app from a passive dashboard into an interactive research engine.
3. **The UX Filter**: Swapping the "FinOps Dashboard" (our internal pride and joy) to the secondary tab in favor of "AI Insights" was the final lesson in user-centric design—making the tool's value proposition visible at the very first frame.

### Entry 11: The Bedrock Blindspot — A CloudWatch Confession
*Date: 2026-04-13*

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

### Entry 12: Bloomberg on a Budget — The v2 UI Overhaul
*Date: 2026-04-13*

With the Bedrock IAM fix confirmed, we turned our attention to what the market insights engine *feels* like to use. The v1 UI was functional, but the v2 goal was ambitious: **Bloomberg Terminal-grade interactivity on a sub-$5/day AI budget**.

**The UX Philosophy Behind Each Feature:**

1. **Async Diff-Patch Rendering** — The original design re-rendered every card from scratch every 15 seconds. On a slow connection this caused an ugly flash. The fix was a diff-and-patch renderer: we maintain a `lastMarketData` snapshot and only touch DOM nodes that have actually changed. The result is silky-smooth background updates.

2. **The Delete Button** — One of the most-requested UX patterns in dashboards. `DELETE /api/v1/tickers/{ticker}` now cascades: it removes from the Tickers table, scrubs MarketData rows, and purges Insights. The card fades out over 300ms. No page reload.

3. **Buy/Hold/Sell Signal** — We updated the Claude prompt to end every synthesis with `SIGNAL: BUY|HOLD|SELL`. This turns Claude from a *narrator* into a *trader*. The signal is parsed, stored in DynamoDB, and rendered as a green/grey/red pill next to the ticker name — the first thing a user reads.

4. **The Expandable Modal** — Single biggest UX lift. Clicking any card opens a modal with a full interactive line chart (powered by Chart.js), a period selector (1D through MAX), key financials (52W high/low, P/E, market cap) and an analyst consensus bar fetched live from `yfinance`. The backdrop blurs the dashboard behind it for focus.

5. **Batch Synthesis on Load** — Previously, the only way insights were generated was via the 5-minute cron or when a new ticker was manually added. Now, on every page load, we check for tickers with stale insights (>10 minutes old) and silently fire `POST /api/v1/tickers/{ticker}/synthesize` in the background. All tickers stay perpetually fresh.

6. **Zoom Controls** — Simple but high-impact for power users tracking many tickers at once. CSS `transform: scale()` with a smooth transition handles it cleanly.

**Stack Note:** All of this was achieved without adding any new npm packages or backend frameworks. The entire upgrade runs on the existing Fargate pod — zero infrastructure cost delta.

### Entry 13: The Dedup Blindspot — Ensuring Full-Portfolio AI Coverage
*Date: 2026-04-13*

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

**Lesson:** Deduplication logic that checks timestamps is fragile when the data it's deduplicating can come from fundamentally different sources (fallback vs. real AI). The fix is to also check *what generated the insight*, not just *when*.

### Entry 14: Centralized Control and Better Density
*Date: 2026-04-13*

Shortly after the v2 rollout, we received crucial user feedback pointing out a few friction points in the UX:
1. **Accidental Deletions:** Having a delete 'X' directly on every ticker card made it too easy to accidentally wipe a ticker from the dashboard.
2. **Blurry Zoom:** The `transform: scale()` CSS method used for the zoom buttons caused the text and charts to look blurry, and it didn't reflow the grid nicely.
3. **Contrast:** The hyperlinked news headlines were hard to read against the dark glass panels.

To fix these without bloating the `app.js`, we implemented "UI V3" (v2.1.0):

- **Manage Watchlist:** We stripped the delete buttons from the individual cards. We replaced this with a centralized "Manage Watchlist" button in the control bar. Clicking it toggles a clean dropdown panel where users can view all tracked tickers and delete them safely.
- **Grid Density:** The zoom buttons were replaced by a "Grid Density" toggle. Instead of scaling the UI, this toggles CSS classes (`density-compact`, `density-standard`, `density-wide`) on the grid container itself, adjusting the `min-width` of the grid columns. This reflows the cards perfectly without any blurriness.
- **Refined Aesthetics:** News links were bumped to a high-contrast `#7dd3fc` with a subtle underline to make their clickability obvious. 

This concludes the major UX phase. The UI is now highly interactive, safe from accidental clicks, and respects the user's screen space much better.

### Entry 15: True Chart Zooming and the Invisible Ticker Problem
*Date: 2026-04-14*

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

**True Zoom Capabilities:**
The final feedback iteration pointed out a UX flaw: the original placeholder "Zoom" buttons mapped to a CSS scaling trick over the grid (which made text blurry). We ripped this out entirely and replaced it natively with `chartjs-plugin-zoom` combined with `hammer.js`. Now, mouse wheels and trackpad pinches zoom intuitively into the localized X-axes of both the Portfolio overview chart and the Ticker historical candlestick chart themselves.

---

### Entry 16: System Self-Healing and Dark Mode Restoration
*Date: 2026-04-14*

During testing following our recent rate-limiting upgrade, we uncovered two critical issues affecting user experience and data fluidity.

**Dark Mode Regression:**
A syntax error in `style.css` (specifically, an accidental truncation of the `:root {` block) caused the browser to lose access to all custom glassmorphic CSS variables. This forced the dashboard to fall back into a stark white mode. We restored the root selector immediately, returning the dashboard to the intended `#0f172a` minimal aesthetic.

**The "White Screen of PENDING" and Auto-Recovery Loop:**
Previously, we established a `pending_data` visual state for tickers that failed their initial upstream fetch (due to strict rate limits on `yfinance`). However, these tickets would stay stuck in a "pending" card until the backend background polling script executed 5 minutes later.
- **The Fix:** We built a dedicated `POST /api/v1/tickers/{ticker}/ingest` endpoint bypassing caching buffers.
- In `static/app.js`, we integrated a self-healing automation loop named `triggerBatchIngestion`. When the frontend UI receives tickers flagged with `pending_data`, the interface naturally updates the static text to an animated spinner. Behind the scenes, `triggerBatchIngestion` executes staggered background polling (buffered 2-seconds apart) to seamlessly force upstream metadata loads.
- This results in a magical user experience: Rate-limited tickers momentarily enter a "pending" spinner state but quickly recover themselves autonomously within a few seconds without taking down the wider UI infrastructure.

---

### Entry 17: Normalized Financial Visualization & the Cache Trap
*Date: 2026-04-14*

Our Auto-Recovery "pending" logic worked beautifully on a minor scale, but as users imported massively diverse portfolios, we hit two distinct architectural hurdles.

**The Infinite Rate-Limit Loop:**
The previous fix looped over missing tickers and requested ingestions every 15 seconds. However, if a user had over 5 tickers pending, they instantly crashed into the `5/minute` API rate-cap. Their IP got banned before the data could fetch, and the loop repeated relentlessly. We solved this by instituting a local JavaScript `Set()` memory trap to ensure no ticker is ever re-ingested twice per loaded session, while raising the endpoint threshold to `30/minute`.

**Portfolio View - Scale Mismatches:**
The Portfolio Summary card previously rendered an aesthetic Pie/Bar component. The flaw occurred if tracing `$0.01` volatile tokens alongside `$100,000` institutional holdings; the chart representation became uselessly distorted.
- **The Fix:** We completely rewrote `updatePortfolioChart()`. The UI now executes background pulls of the trailing 1-month market history for every tracked item. We loop this array alongside a baseline initialization function: `((current_price - start_price) / start_price) * 100`. 
- Every ticker represents exactly `0%` on day one, and curves beautifully along a unifying Time-Series multi-line grid graph.

---

### Entry 18: Pure Absolute Pricing & Persistent Recovery
*Date: 2026-04-14*

Sometimes "mathematically perfect" UI decisions (like percentage normalization) aren't what the user actually needs for their workflow. We pivoted the portfolio chart away from percentages back to absolute USD values. 

**The Scaling Paradox:** 
By switching to absolute values, we immediately ran into the scaling issue where expensive stocks flattened cheaper ones. We solved this by implementing a **Logarithmic Y-Axis**, which preserves the visual magnitude of percentage moves while showing the real dollar price.

**Eliminating the Infinite Spinner:**
The "pending" states were stickier than expected because our previous "one-shot" ingestion attempt wasn't accounting for transient backend failures or Yahoo Finance empty responses.
- **Backend Fix:** We now pull a 5-day window for every single ticker check. If today is a holiday or a Sunday, we successfully fall back to Friday's data instead of returning `None`.
- **Frontend Fix:** We removed the binary "tried once" lock. Tickers now retry every 15 seconds until they succeed, but we added an "active ingestion" guard to prevent parallel hammering of the same ticker within the same cycle.
- **Throttling:** We raised the ingestion limit to 5 per second, providing enough headroom for a large portfolio to fully self-heal in a single burst.

---

### Entry 19: The Pivot to Simplicity & Robust Fallbacks
*Date: 2026-04-14*

Complexity for complexity's sake often backfires. Our multi-line time-series experiment, while mathematically sound, introduced mapping bugs (the date/time mismatch) and didn't provide the immediate "at-a-glance" value the user wanted.

**Reverting for Clarity:**
We reverted the main portfolio visual to a **Bar Chart**. By focusing on absolute `close_price`, we provide immediate feedback on asset magnitude. To handle the disparate price scales, we ensured the chart is cleanly sorted by value.

**Solving the "Stuck" Ingestion:**
The primary cause of the persistent "Pending" banners was a reliance on `ticker.history(period="1d/5d")`. On certain days, Yahoo's API returns empty frames for these specific calls, even while the stocks are very much active.
- **The Solution:** We implemented a prioritized fallback. If history fails, we ping `ticker.fast_info` then `ticker.info` for the `regularMarketPrice`. 
- This ensures that as long as the ticker is valid, the engine *will* find a price, move the ticker into "Active" status, and clear the dashboard for analysis.

---

### Entry 20: The Invisible Data Problem — DynamoDB Pagination and the Startup Throttle
*Date: 2026-04-15*

After the v2.3.x stabilization pass, a persistent and deceptive bug remained: on every page refresh, only the **first 2–3 tickers** showed live prices. The rest (META, IBM, AMD) were permanently stuck in `pending_data` spinner state despite Bedrock being healthy and insights existing for them.

**The Live Diagnosis:**

We fetched the raw API endpoints directly to establish ground truth:

```
GET /api/v1/tickers  → ["NVDA", "TSLA", "META", "IBM", "AMD"]
GET /api/v1/market   → NVDA: active ✅ | TSLA: active ✅ | META: pending ❌ | IBM: pending ❌ | AMD: pending ❌
GET /api/v1/insights → All 5 tickers have real Claude insights ✅ (+ ghost AAPL insight ⚠️)
```

The contradiction was the key: **Insights existed for META/IBM/AMD but MarketData did not.** This ruled out Bedrock, yfinance, and IAM as the cause. The failure was in how the API *read* data back out of DynamoDB.

**Root Cause 1 — DynamoDB `scan()` Silently Truncates at 1MB (Primary)**

`GET /api/v1/market` and `GET /api/v1/insights` both called `table.scan()` with no pagination logic. DynamoDB's `scan()` API returns up to 1MB per call and signals more data is available via `LastEvaluatedKey` — but if you ignore that key, you silently lose everything past that boundary.

As our 5-minute ingestion cron wrote rows for all 5 tickers repeatedly, the MarketData table grew. The `scan()` page returned NVDA and TSLA (the most recently written) but silently dropped the older entries for META, IBM, and AMD. Our Python dedup logic (`if t not in latest`) only ever saw the first page, so those tickers never registered as having MarketData rows.

**The Fix:** Replaced both `table.scan()` calls with per-ticker `table.query(KeyConditionExpression=Key('ticker').eq(t), ScanIndexForward=False, Limit=1)`. This retrieves exactly the latest row per ticker in a single DynamoDB operation, scales to any table size, and eliminates the pagination blind spot entirely.

**Root Cause 2 — Synchronous Startup Ingestion Race**

`main.py` called `scheduled_job()` *synchronously inside the `lifespan()` function* — meaning the container couldn't finish startup (and therefore couldn't pass ALB health checks) until all 5 tickers had been fetched from yfinance. On ECS task replacement, yfinance throttles after ~2 sequential requests from a fresh cloud IP, so tickers 3–5 never got written. The ECS health check eventually timed out and replaced the task — repeating the cycle.

**The Fix:** Moved startup ingestion to a `daemon=True` Python thread with a 10-second delay. The app becomes healthy and passes the ALB health check immediately. After 10 seconds, the ingestion fires from an already-warm container with established network routes, dramatically reducing yfinance throttle probability.

**Root Cause 3 — Ghost Insights for Removed Tickers**

`GET /api/v1/insights` was scanning the entire Insights table and returning results for any ticker that ever had an insight written — including AAPL, which had been removed from the watchlist. The fix: only query insights for tickers that currently exist in the Tickers table.

**Lesson:** `scan()` is rarely the right tool for lookup-by-key patterns. DynamoDB is a key-value system — use `query()` with your actual access patterns. The silent pagination truncation is especially insidious because the code *appears* to work at small scale and only fails as the table grows.

### Entry 21: The Bloomberg Polish — Bulleted Insights & Terminal UX
*Date: 2026-04-17*

While the engine was functionally "concluded" as a production microservice, the gap between a "tool" and a "terminal" lies in the density and readability of its data. We executed a specialized polish phase aimed at achieving **Bloomberg-grade visual hierarchy**.

**1. Hero Stat Prominence:** 
We refactored the ticker detail modal to distinguish between "Main" and "Secondary" metrics. The Last Price and Day Change now dominate the header on a distinct background layer with increased typography scale (1.8rem). This ensures the most critical data points hit the user's retina instantly upon opening the modal.

**2. Structured "Stick" Insights:** 
Analysis paragraphs can become a "wall of text" in high-stress market environments. We updated the Claude 3 Haiku prompt to enforce a **bulleted structure** across three domains: Market Context, Thesis Impact, and Outlook/Risks. By requiring "sticks" (bullet points) for each detail, we've significantly reduced cognitive load, allowing the user to scan for catalysts in seconds rather than reading full paragraphs.

**3. Analyst Depth & Target Prices:** 
We deepened the connection to yfinance's internal analyst maps. Beyond just the recommendation bar, we now extract and surface the **Mean Target Price**. We also hardened the analyst summary parsing to handle recent changes in yfinance's data structures, ensuring the "Strong Buy → Strong Sell" visualization remains active and accurate.

**4. White-Space Harmony:** 
To preserve the new structured output from Claude, we updated the CSS to handle preservation of newlines and added paragraph spacing. The insight text now breathes, reflecting a modern, premium finance dashboard aesthetic.

### Entry 22: From "Equity Analyst" to "Investment Assistant"
*Date: 2026-04-26*

While the v2.5 phase achieved Bloomberg-level density, user feedback indicated that the language was drifting into "Institutional Jargon." Terms like *Key Catalyst* and *Thesis Status* are precise but can feel convoluted to everyday users. We executed a "friendly polish" to pivot the engine's persona from a cold analyst to a helpful assistant.

**1. The "Investment Assistant" Persona:**
We rewrote the Bedrock prompt to prioritize conversational clarity. Instead of abstract sections, we structured the AI's output around three instinctive questions:
- **What's Happening?** (Market context)
- **Why it Matters?** (Investment impact)
- **What to Watch?** (Actionable follow-up)

**2. Intelligent Formatting Logic:**
To make this new structure "pop" visually, we updated the `formatInsight` utility in `app.js`. The renderer now performs a split-scan on every bullet point. If it detects a category label followed by a colon (e.g., "What's Happening:"), it automatically wraps that label in a `<strong>` tag. This provides institutional-grade scannability without requiring the AI to manage complex HTML or Markdown formatting consistently.

**3. Tackling Truncated Intelligence:**
We discovered a data gap in the "About" section for complex large-cap companies. The original 800-character limit was cutting off critical business model details for conglomerates like Amazon or Apple. We quadrupled the limit to **3,000 characters** in the market history route. Combined with the existing modal scroll architecture, this provides deep-dive research capabilities without cluttering the primary dashboard view.

**4. Friendly UI Labels:**
Finally, we updated the static headers in the detail modal. "Key Statistics" became **Quick Stats**, "Analyst Consensus" became **What Experts Say**, and "AI Synthesis" became **Latest AI Take**. 

**5. Progressive Disclosure:**
To further clean up the dashboard, we implemented a progressive disclosure pattern for AI insights. The main dashboard cards now only render the first bullet point (the "What's Happening" catalyst), reducing the card's vertical footprint. Clicking a ticker card opens the modal, which reveals the full 3-point synthesis. This "summary-first" approach keeps the high-density grid readable while still providing deep-dive context on demand.

**6. Educational Transparency (How it Works):**
To build trust in the "Cost-Aware" claim, we added a "How it Works" tab. This isn't just static text; it features an animated system diagram where "data particles" flow between nodes (External Data → Core Engine → DynamoDB → Bedrock). This helps users visualize the invisible "FinOps Gate" that protects their budget, transforming a technical constraint into a transparent value proposition.

This iteration completes the cycle from *raw data* to *structured analysis* and finally to *accessible insight*.

### Entry 23: Ticker Autocomplete and the "Clean Exit" Strategy
*Date: 2026-05-04*

As the engine reached a stable production state, we identified two final friction points: the manual entry of stock tickers and the complexity of stopping an AWS deployment once it's no longer needed.

**1. Smart Ticker Autocomplete:**
Previously, users had to know the exact ticker symbol to track an asset. We integrated a new `/api/v1/search` endpoint that acts as a proxy to the Yahoo Finance search API. This allowed us to build a **real-time, debounced autocomplete dropdown** in the UI. 
- **The UX Twist:** The user requested that we prepend the trading platform (e.g., `NASDAQ: AAPL`). While this is excellent for user context, `yfinance` only accepts the raw symbol. 
- **The Solution:** We implemented a "Selection Stripper" in `app.js`. The UI displays the full exchange prefix to the user, but upon clicking "Track Ticker," the frontend silently parses the string and only sends the final ticker symbol to the backend. This preserves both the premium UI context and backend data integrity.

**2. The "Clean Exit" Automation:**
Deploying to AWS is powerful, but tearing it down manually through the console is tedious and error-prone (leaving orphaned ECR images or Load Balancers can lead to surprise bills).
- **The Solution:** We engineered `scripts/teardown.sh`. This script handles the destructive logic of forcing an ECR repository deletion (including all image tags) and triggering a CloudFormation stack deletion. This gives users a "one-click" exit strategy to return to a local-only environment without any cloud-residue.

**3. Cache Busting for UX Integrity:**
With major JS and CSS changes, we encountered the classic "stale browser cache" issue where the new autocomplete dropdown wouldn't appear for existing users. We implemented a manual versioning system (`?v=6`) in `index.html` for all primary static assets, ensuring that as soon as the container is updated, the user's browser is forced to fetch the latest logic.

This phase moves the engine from a "power-user tool" to a polished consumer-grade experience, balancing high-end features with administrative simplicity.

### Entry 24: Distributed Evolution - The Alpha-DAG and MCP
*Date: 2026-05-06*

We hit a massive architectural milestone today. Our "Phase 1: Local MVP" monolithic architecture served us well for proving the FinOps concepts, but scaling AI requires isolation and robust state management. Today, we executed **Phase 2: Alpha-DAG**.

**1. Deconstructing the Monolith with LangGraph:**
We replaced our rigid `APScheduler` loops with a **LangGraph Directed Acyclic Graph (DAG)** (`src/dag/graph.py`). This allows us to orchestrate a true multi-agent workflow where state (`AlphaDagState`) is passed safely between nodes. 
- *The FinOps Pre-Flight Gate*: The absolute most critical feature. We wired our existing DynamoDB budget checker as the *entry point node* of the graph. If it projects a budget breach, the `finops_router` conditionally branches execution away from AWS Bedrock, ensuring we never spend a rogue cent.

**2. Absolute Isolation via the Model Context Protocol (MCP):**
Security and execution safety are non-negotiable. To prevent the LLM from ever executing arbitrary Python code in an environment holding our AWS credentials, we adopted the open-source **MCP** standard:
- We extracted our `yfinance` logic into a `Market Data MCP Server`.
- More importantly, we built an isolated `Quant Compute MCP Server`. This runs inside a deeply restricted Docker container with no network egress, solely responsible for executing deterministic Pandas and Numpy calculations passed to it by the orchestrator.

**3. The Shadow Deployment Strategy:**
To test this safely without breaking our active dashboard, we exposed the graph via a new endpoint: `POST /api/v2/tickers/{ticker}/synthesize`. This allows the V1 monolith to remain completely active while we stress-test the new V2 Alpha-DAG in the background.

The engine is no longer just a script; it is a distributed, agentic ecosystem.


### Entry 25: Fine-Tuning the Discovery Agent — Filtering and FinOps
*Date: 2026-05-06*

With the Alpha-DAG architecture in place, we turned our focus to the "Daily Discovery Agent." While the agent was successfully picking stocks at 8:00 AM, it was occasionally recommending tickers the user was already tracking.

**1. Watchlist-Aware Discovery:**
We updated the `fetch_universe_node` to perform a pre-flight check against the active `Tickers` DynamoDB table. The agent now explicitly filters out any tickers currently in the user's watchlist, ensuring that every "Hidden Gem" is a genuine discovery.

**2. Discovery Enrichment & Price Metrics:**
To make the discovery picks actionable immediately, we upgraded the `quant_metrics_node` to compute the **Last Price** and **5-Day % Change**. These metrics are now persisted in the `Insights` table alongside the AI rationale. The UI was updated to render these cards as fully interactive elements—clicking a "Discovery Card" now fetches history on-demand and opens a TradingView-style detail modal, providing deep-dive capabilities for untracked assets.

**3. Infrastructure-Aware FinOps:**
Our budget gate was originally focused on LLM token costs. However, in a production AWS environment, the fixed infrastructure costs (ALB + Fargate uptime) represent a significant portion of the burn rate. We updated the `cost_tracking` service to calculate a dynamic `infrastructure_spend_usd` based on a fixed rate of **$0.035/hour** since midnight UTC. The FinOps dashboard now breaks down daily spend into **AI** vs **Uptime**, providing a more realistic view of the project's financial health.

### Entry 26: The Colima Networking Incident
*Date: 2026-05-06*

**Problem:** After a clean `docker-compose up -d --build`, the local dashboard was completely unreachable. `curl` returned `Connection refused` for `localhost:8000`, despite the container health check passing and `docker ps` showing the service as healthy.

**Root Cause (The Docker Context Trap):**
The developer environment was running Docker via **Colima** (a lightweight macOS alternative to Docker Desktop). Unlike Docker Desktop, which automatically handles port forwarding from the macOS host to the internal Linux VM, Colima's default mode runs an isolated VM with no host-accessible bridge interface. Port 8000 was bound inside the VM, but `localhost` on macOS was trying to find a process on the host itself.

**The Fix:** 
Restarted Colima with the `--network-address` flag:
```bash
colima stop
colima start --network-address
```
This forces Colima to provision a bridged network interface and assigns the VM a stable LAN IP (e.g., `192.168.64.2`). The dashboard became instantly accessible at `http://192.168.64.2:8000`.

**Lesson:** In cross-platform development, "Localhost" is an abstraction. When debugging connectivity in containerized apps on macOS, the first check should always be the Docker runtime context (`docker context ls`). If it points to a Colima socket, networking behavior must be verified at the VM level.

### Entry 27: Breaking the AWS Tether — Local AI via Ollama
*Date: 2026-05-06*

While AWS Bedrock is our production target, local development with real AI has always been a "Mock vs. Cost" trade-off. Today, we broke that tether by integrating **Ollama** directly into the engine's synthesis layer.

**1. Multi-Provider Synthesis Architecture:**
We refactored `src/synthesis/service.py` into a provider-agnostic bridge. The system now supports a `LLM_PROVIDER` environment variable that can switch between `mock`, `bedrock`, and `ollama` on the fly. This allows developers to work with high-fidelity insights without burning their AWS budget.

**2. Gemma 4 & Apple Silicon Optimization:**
The user opted for Google's **Gemma 4** model. By configuring Docker with `extra_hosts: ["host.docker.internal:host-gateway"]`, we allowed the containerized app to communicate with the Ollama server running natively on the macOS host. This leverages the Mac's Neural Engine and GPU for lightning-fast inference while keeping the application code portable.

**3. Parsing and Signal Parity:**
We implemented custom parsing logic for Ollama's `/api/generate` endpoint to maintain parity with our structured Claude outputs. The engine still expects the `SIGNAL: BUY/HOLD/SELL` suffix and correctly maps it to our DynamoDB schema, ensuring the dashboard UI remains consistent regardless of the underlying brain.

The project is now "Local-First, Cloud-Ready."

### Entry 28: Global Scale and Interactive Visuals
*Date: 2026-05-07*

As the engine's core orchestration stabilized under the Alpha-DAG, we shifted our focus to the "last mile" of user experience: global accessibility and interactive data storytelling.

**1. Multi-Currency Infrastructure:**
Trading is global, but our dashboard was anchored in USD. We implemented a real-time currency conversion layer that supports **USD, EUR, GBP, AUD, and JPY**. By integrating a centralized exchange rate provider into the frontend, we now dynamically recalculate every price point, budget metric, and chart axis on the fly. This ensures that a user in Sydney or London sees their market insights in the context of their own local liquidity.

**2. Interactive Portfolio Storytelling:**
Visualizations should be gateways, not just static images. We upgraded the Portfolio Summary chart to be fully interactive. Clicking on a specific bar or line in the chart now triggers a "Jump-to-Modal" action, instantly opening the deep-dive research modal for that specific ticker. This creates a seamless flow between high-level portfolio oversight and granular asset analysis.

**3. The Zero-Flicker UX:**
Market data is noisy. Previous iterations of the background refresh loop caused subtle chart "jitters" as animations reset every 15 seconds. We disabled the entry animations for periodic background updates, creating a "zero-flicker" environment where data flows in silently. The UI only pulses when a user manually interacts or when a significant state change occurs, maintaining the premium, terminal-like stability required for professional monitoring.

**4. Educational Infrastructure:**
To demystify the "Agentic" nature of the system, we expanded the **How it Works** section. We added a dedicated breakdown of the **Daily Discovery Agent's** mathematical algorithm (annualized volatility + momentum scoring). Combined with the animated infrastructure diagram, this bridges the gap between complex engineering and user trust, showing exactly how the engine autonomously hunts for value while staying within budget.

**5. AI Formatting Polish:**
Finally, we brought the "Investment Assistant" persona to the Discovery Picks. By applying our structured formatting logic to the discovery rationales and enabling full modal expansion for discovery picks, we've ensured that "Hidden Gems" receive the same level of analytical depth as the user's primary watchlist.


### Entry 29: Closing the Discovery Gap - Structured Rationale and Live Hydration
*Date: 2026-05-07*

As we moved towards the conclusion of Phase 4, we identified a critical "UX gap" in how the **Daily Discovery Agent** presented its findings. While the main watchlist items felt premium and data-rich, the discovery picks suffered from two distinct issues: convoluted analysis and missing market data in the deep-dive modals.

**1. The Structured Rationale Pivot:**
The Discovery Agent previously emitted long, unstructured paragraphs. This clashed with our "Investment Assistant" persona. We refactored the prompt within the `discovery_graph.py` to enforce a strict **2-point structure**:
- **What's Happening**: A high-level view of the current catalyst.
- **Why Track**: A specific, actionable reason for the user to add this to their watchlist.

*Stability Note*: During this pivot, we encountered an issue where some LLM providers (specifically when using local Ollama instances) would return these bullet points as a JSON array instead of a single string. This caused the frontend's string-manipulation logic to crash, resulting in the "disappearing" discovery section. We've since implemented a robust **array-to-string transformation** in `app.js` to ensure that regardless of the LLM's structural interpretation, the insights are rendered flawlessly.

**2. Asynchronous Hero Stat Hydration:**
Because discovery picks are untracked "Hidden Gems," their real-time pricing isn't stored in our local DynamoDB ledger. When a user clicked a discovery card, the modal would initially render `$NaN` for prices.
- **The Fix**: We updated the `market.py` history endpoint to extract a "Live Quote" block directly from the `yfinance.info` object.
- **The UX Finish**: We updated `app.js` to handle a `pending_data` state for these modals. The UI now renders clean dashes (`--`) instantly, while the background history request fetches the live quote and dynamically hydrates the header stats. 

This final polish ensures that the discovery process feels as professional and data-backed as the core portfolio management experience. The engine is now fully optimized for both global monitoring and autonomous asset discovery.

### Entry 30: TradingView-Grade Scannability & Multi-LLM Clarity
*Date: 2026-05-07*

As we reached the final stages of UI polish, we prioritized "Scannability at Scale." A professional trader doesn't just look at symbols; they need to know the exchange and the full entity name without clicking through deep-dive modals.

**1. Metadata Integration (Exchange & Entity):**
We refactored the `MarketData` ingestion cycle to explicitly fetch and store the `exchange` and `longName` (Company Name) from Yahoo Finance. This data is now surfaced directly on the dashboard cards. To ensure user clarity, we implemented a `formatExchange` mapping that transforms cryptic identifiers like **NMS** and **NYQ** into easily recognizable names like **NASDAQ** and **NYSE**. The exchange is positioned at the very top in a high-contrast accent color, while the company name sits directly below the symbol, providing immediate institutional context.

**2. Dynamic Currency Pricing:**
We eliminated hardcoded exchange rates by implementing a backend `/meta/rates` service. This service leverages the **Yahoo Finance FX API** to fetch real-time conversion rates for EUR, GBP, AUD, and JPY relative to the USD. The rates are cached server-side for one hour to maintain performance while ensuring that global users see portfolio valuations that reflect current market reality.

**3. Right-Aligned Pricing Alignment:**
We shifted the pricing and percentage change blocks to the far right margin of the cards. By decoupling the symbol/name (left) from the price action (right), we've created a clean vertical corridor for the eyes to scan. This aligns with professional terminal standards like TradingView or Bloomberg, where the "what" and the "how much" are spatially separated for clarity.

**3. Multi-LLM Documentation & Portability:**
With the system now successfully toggling between **Ollama (Local)** and **Bedrock (Cloud)**, we updated the `README.md` to reflect this "Hybrid-AI" reality. We provided clear on-boarding paths for developers starting with zero budget using open-source models (Llama 3.2), while maintaining the seamless transition script to AWS ECS for production deployments.

**4. The "Compact" Purge:**
In our pursuit of a premium experience, we removed the "Compact" view option. While functional, it compromised the visual hierarchy of our new metadata-rich cards. We've standardized on **Horizontal** and **Wide** views, ensuring that the engine always presents a polished, data-dense interface without visual clutter.

### Entry 32: The "Intraday Momentum" Upgrade

**Date:** 2026-05-07
**Milestone:** Visual Fidelity & Scalability

Today we pushed the Market Insights Engine into "Pro Terminal" territory by solving the missing context of intraday price action and significantly expanding the engine's tracking capacity.

**1. The 24-Hour Pulse:**
While the dashboard provided excellent daily summaries, it lacked a visual "pulse" of how a stock moved *during* the day. We implemented **24-hour sparklines** into every ticker card. These aren't just decorative; they ingest 15-minute interval data directly from our market service, providing immediate visual feedback on whether a stock is trending up or down since the last session.

**2. Breaking the 10-Ticker Ceiling:**
User feedback indicated that the 10-ticker limit was too restrictive for serious monitoring. We refactored our ingestion and rendering logic to support **30 tracked tickers** simultaneously. To maintain performance, we optimized the "Async Diff-Patch" loop to handle the increased data volume without UI lag.

**3. Visualization Polish:**
The main portfolio bar chart received a significant "FinOps" refinement. We removed interactive zooming—which often led to accidental layout shifts—and replaced it with static **data labels** pinned above each bar. This allows for instant, cross-portfolio price comparison at a single glance, without requiring hover or click interactions.

---



## Entry 33: Deep System Stabilization and Global Market Parity

**Date:** 2026-05-07
**Milestone:** Resilience & Internationalization

Following the UI expansions in Entry 32, we encountered several critical backend and logic hurdles that threatened system uptime. This entry details the "under-the-hood" work required to stabilize the engine for a global audience.

**1. The `yfinance` Multi-Index Patch:**
A silent breaking change in the `yfinance` library caused our Discovery Agent to fail data retrieval. When performing bulk downloads, the library now defaults to a MultiIndex DataFrame structure. We refactored `src/dag/discovery_graph.py` to explicitly handle multi-level column indexing, ensuring that our daily "S&P 500" and "Hidden Gem" analysis remains fully automated and resilient to library updates.

**2. Dynamic Currency Normalization:**
To properly support Australian (e.g., `NAB.AX`) and European markets, we moved beyond hardcoded USD logic. 
- **Live Rates**: Implemented a real-time exchange rate service in `src/routes/meta.py` fetching pairs like `USDAUD=X` and `USDJPY=X`.
- **Currency-Aware Rendering**: The dashboard now intelligently detects the ticker's native currency and normalizes it to the user's selected preference (USD, AUD, EUR, or JPY) using a two-way conversion pipeline.

**3. Frontend Syntax Protection & Robustness:**
- **The "Blank Screen" Fix**: Resolved a fatal JavaScript `SyntaxError` (duplicate identifier) that was preventing the entire dashboard from initializing.
- **Backend Hardening**: Updated the `/api/v1/market` and `/api/v1/insights` routes with safer `.get()` accessors. This ensures that even if a ticker has partial or legacy data in DynamoDB, the dashboard remains functional instead of returning a 500 error.


The engine is now significantly more stable, accurate across international borders, and better prepared for the 30-ticker volume expansion.

## Entry 34: Designing the "Discover" Experience — From Watchlist to Market Intelligence Hub

**Date:** 2026-05-07
**Milestone:** Phase 5 — Navigation Redesign & Global Market Intelligence

With the core tracked-asset experience stable, we identified the next meaningful leap: context. Knowing that AAPL is up 1.2% is useful; knowing that the broader Nasdaq is up 0.8% on the same day makes it *meaningful*. This entry documents the design decisions behind the upcoming v2.9.0 dashboard restructure.

**The Information Architecture Problem:**
The original single-tab structure ("AI Market Insights") mixed two conceptually different jobs: *managing* what you're tracking, and *discovering* what's happening in the world. As the ticker limit grew to 30, this conflation became increasingly apparent. Users needed a clear separation between "my portfolio" and "the market."

**The Navigation Redesign:**
We restructured the navigation to reflect intent:
- **Manage** — Replaces "AI Market Insights". A workspace for your tracked assets with search, filter (country/exchange), and sort controls. The portfolio chart is upgraded from a static bar chart to a 24-hour time-series area chart, giving a live pulse of your combined portfolio value.
- **Discover** — A new real-time global market briefing room. At a glance: major regional indices (ASX 200, S&P 500, Nasdaq, Euro Stoxx 50, Nikkei, Hang Seng), commodity prices (Gold, Oil, Silver), the day's top 10 movers in both directions, and the 10 most recent market headlines.
- **Costs / How it Works** — Moved to the far right of the navigation, reflecting their "reference" nature vs. the primary "action" tabs.

**The "Empty Cache" Problem:**
A key reliability design decision: all three new Discover endpoints (`/discover/indices`, `/discover/movers`, `/discover/news`) implement a "force-refresh on empty" pattern. If no cached data exists when a user first opens the tab, the endpoint performs a synchronous live fetch instead of returning an empty response. This is layered with a startup pre-warm in `main.py` that runs alongside the existing daily picks check, ensuring the Discover tab is populated from the very first page load without any scheduler dependency.

**Status:**
Implementation is complete. The backend routes in `src/routes/discover.py` are live, and the frontend has been fully restructured. The transition from a simple watchlist to a comprehensive market intelligence terminal is now the operational baseline for the engine.

**What's Next:**
With the information hub established, we turn our attention to Phase 6: Multi-Agent Collaborative Refinement. We'll be introducing specialized "Sentiment Agent" nodes to the Alpha-DAG to ingest alternative data (Reddit/X), providing a qualitative layer to the quantitative insights already provided by the Discovery Agent.


### Entry 35: Stability, Redundancy, and the NaN Problem (Post-Redesign Debugging)
**Date:** May 7, 2026
**Version:** v2.9.1

The deployment of the Phase 5 redesign (v2.9.0) was a major structural shift, but as is often the case with such updates, the first few minutes of live operation revealed a few critical integration gaps. This entry documents the rapid-response debugging that led to the v2.9.1 stability patch.

**The Routing Blind Spot:**
The most immediate issue was a series of 404 errors for the new Discover endpoints. Despite the code being volume-mounted in the Docker container, the lack of an `--reload` flag in the production-style `uvicorn` command meant the new routers were only registered on the host, not in the running process. A full container rebuild and restart resolved the connectivity issues, but it served as a reminder that architectural changes require process-level restarts even in "hot-reloadable" environments.

**The "NaN" Serialization Trap:**
As soon as the indices and movers endpoints went live, we encountered a classic financial data pitfall: `ValueError: Out of range float values are not JSON compliant: np.float64(nan)`. Market data APIs like `yfinance` occasionally return `NaN` (Not a Number) for assets that haven't traded yet or are undergoing maintenance. While Python handles these floats fine, the standard JSON encoder used by FastAPI/uvicorn rejects them.

We resolved this by implementing a global `clean_float` utility across all market and discovery routes. This helper catches `NaN` and `Inf` values at the route level, defaulting them to `0.0` before serialization. This ensures the API is resilient to the "sloppiness" of live market data streams.

**The Chart Restoration:**
Finally, we fixed a field-naming mismatch in the new Portfolio Area Chart. The frontend was looking for a `sparkline_data` array, but the API response had normalized the field to simply `sparkline`. This small discrepancy prevented the combined portfolio total from rendering. With this fixed, the Manage tab now correctly visualizes the 24-hour pulse of the tracked assets.

**Status:**
V2.9.1 is now stable and fully operational. All Discover sections (Indices, Commodities, Movers, and News) are successfully hydrating, and the Portfolio Chart is correctly calculating and displaying combined asset values in real-time.
+
+
+### Entry 36: AI Transparency and the "Smart Narrative" Pivot
+**Date:** May 7, 2026
+**Version:** v2.9.2
+
+With the structural redesign of the Discover and Manage tabs complete, the final Polish phase for this milestone focused on a core tenet of user trust: **AI Transparency**.
+
+**The Problem of the "Black Box":**
Initial feedback on the Discovery Agent's picks was that they felt like a "black box." The AI would recommend a ticker, but the justification was often a single block of text that lacked quantitative grounding. Users were asking, "Why *this* ticker, and why *now*?"

**Solution: The 3-Bullet Smart Narrative**
We overhauled the `discovery_graph.py` prompt to enforce a structured, 3-bullet rationale format for every recommendation. By shifting from a free-form string to an explicit JSON array of three specific points—**What's Happening**, **Why It's Interesting**, and **What to Watch**—we've created a consistent, scannable, and human-readable explanation.

To ground these insights, we also expanded the `DiscoveryState` to capture and surface quantitative performance metrics (`momentum_1mo`, `volatility_ann`). These are now displayed directly on the discovery cards, providing a "data-first" validation that complements the AI's qualitative synthesis.

**Polishing the Information Hub:**
Finally, we closed the "granularity gap" in the Discover tab:
- **Commodity Units:** No longer just a price; we now explicitly label units (e.g., `Gold (oz)`, `Crude Oil (bbl)`), making the data instantly interpretable to those outside of specialized trading circles.
- **Company Identifiers:** Top Movers now include full company names alongside ticker symbols. This is a small but critical usability fix—most humans recognize "NVIDIA" faster than "NVDA".
- **News Context:** News headlines in the Discover feed now feature short descriptions, allowing users to gauge the relevance of a story before clicking through.
- **Vertical Regional Layout:** Reorganized Global Markets into distinct vertical columns (USA, Europe, Asia Pacific). This replaces the horizontal row-based flow with a clean, side-by-side "command center" view that simplifies regional comparison.
- **Extended Hours Context:** Integrated real-time `preMarketPrice` and `postMarketPrice` data across every ticker UI. Whether it's a tracked asset in the Manage tab, a Daily Pick, or a Top Mover, users now have instant visibility into price action outside of standard exchange hours—a critical feature for identifying gaps and momentum before the opening bell.

**Status:**
The Market Discovery Hub has transitioned from a data-visualization tool to a decision-support platform. AI recommendations are no longer just "takes"; they are transparent, data-backed narratives.

**Next Steps:**
With the UI and AI synthesis logic now fully refined, we are ready to scale the system's collaborative capabilities. Phase 6 will explore the integration of a **Sentiment Analysis Node** to the LangGraph DAG, allowing the engine to compare hard quantitative data against the "soft" signals of market sentiment from social platforms.

---

### May 7, 2026: Achieving 24-Hour Market Transparency

The final pieces of the Market Discovery Hub have fallen into place, focusing on absolute data clarity and real-time relevance. 

**The 24-Hour Price Stack:**
The gap between the standard market close and the opening bell is where some of the most significant moves happen. To ensure our users are never caught off-guard, we've implemented an explicit "Price Stack" across the entire UI. Every ticker now displays:
- **Explicit Close Price:** Clearly labeled as `CLOSE` to anchor the data.
- **Pre & Post Market Context:** Labeled as `PRE` and `POST`, these indicators now include both the price *and* a momentum-aware change percentage. This allows users to immediately identify "gaps" in the price action before the main session begins.

**Real-Time News Recency:**
A market insights engine is only as good as its latest data. We discovered that the default RSS behavior often prioritized relevance over recency, which could bury breaking news. We've overhauled the news service to enforce a strict chronological sort across all feeds. Whether you're looking at the global headlines or a specific ticker's news, the absolute latest information is now guaranteed to be at the top.

**Refining the Professional Aesthetic:**
We've standardized the terminology across the platform—moving away from generic terms like "Last Price" to the more accurate "Close Price." This small semantic shift, combined with the new 4-column "command center" layout, solidifies the engine's position as a professional-grade tool for informed decision-making.

**Status:**
**FUNCTIONALLY COMPLETE.** The system now provides a transparent, 24-hour view of the global markets, grounded in both historical close data and live extended-hours activity.

---


 ---
 
 ### May 8, 2026: The Localization Battle & JSON Normalization
+
+As we moved toward a truly global dashboard, we hit two distinct engineering walls: misleading currency labeling for international assets and the "Schema-Rigidity" problem with local LLM models.
+
+**1. The Misleading Dollar Sign ($):**
+Our dashboard was technically "Multi-Currency" (supporting USD, AUD, EUR, etc.), but it suffered from a "USD-Default" bias in its display logic. An asset in the Tokyo Stock Exchange (e.g., 9984.T) was displaying a dollar sign next to a Yen-denominated price — a highly misleading and unprofessional UX.
+
+We solved this by implementing an **Exchange-Aware Formatting Layer** in the frontend. The dashboard now detects the asset's exchange (e.g., TSE, ASX, HKSE) and automatically overrides the currency symbol with the native character (¥, A$, HK$, etc.) regardless of the user's base currency setting. This ensures that global liquidity is represented with absolute semantic accuracy.
+
+**2. The Ollama JSON Battle:**
+While our production Bedrock (Claude 3) models followed our LangGraph schema perfectly, our local development model (**Llama 3.2 via Ollama**) was struggling. It would occasionally return recommendations as a **Dictionary** (`{"S&P 500": {...}}`) instead of the requested **JSON List**. Since our initial parser used a strict `[` search, the Discovery Agent would silently fail to extract any data.
+
+We pivoted to a **"Flexible JSON" extraction strategy** in `discovery_graph.py`. The parser now uses robust regex to look for both `[...]` and `{...}` structures. If it finds a dictionary, it triggers an internal **Normalization Logic** that flattens the keys into our standard schema. This "Defensive Parsing" has made the engine significantly more resilient, allowing for high-fidelity local development without the overhead of cloud provider rigidity.
+
+**3. Support for the Pacific Rim:**
+We officially expanded our currency bridge to include **HKD, CAD, SGD, and NZD**. By wiring these into our backend FX service, we've enabled the engine to track assets across the entire Pacific Rim with real-time conversion and native formatting.
+
+**Status:**
+The engine is now truly global. Whether you are tracking a tech giant on the Nasdaq or a hidden gem on the Hong Kong Stock Exchange, the data is accurate, the labeling is localized, and the AI synthesis is robust across both local and cloud environments.
+
+---
+
+### May 7, 2026: Multi-Timeframe Discovery

We've bridged the gap between "at-a-glance" monitoring and deep historical analysis. By adding **interactive period selectors** to every tracked asset card, we've transformed the static sparklines into dynamic research tools. Users can now toggle between a 1-day view and a 1-year view without leaving the Manage tab, allowing for rapid-fire validation of long-term trends against short-term price action.

## Entry 37: The Analytical Leap — Global QMJ Screener & Data Lakehouse

*Date: 2026-05-11*

While the Discovery Agent provided excellent momentum-based picks, the engine lacked a "Quality" dimension—the ability to filter for fundamentally strong businesses. Today, we executed **Phase 7: The Global QMJ Screener**.

**1. Quantitative Rigor (Quality Minus Junk):**
We implemented a scoring algorithm inspired by the QMJ factor. We focus on two primary pillars: **Profitability** (ROE, ROA, and Cash Flow Margins) and **Safety** (Leverage Ratios). The engine now automatically ranks every tracked asset relative to the wider universe, assigning a percentile-based `qmj_score` (0–100). This allows users to instantly identify which "Hidden Gems" are high-quality compounders and which are speculative "junk."

**2. The Open Data Lakehouse (dbt + DuckDB):**
Architecturally, this was our biggest shift since the Alpha-DAG. We moved away from performing calculations in raw Python and adopted the **dbt Core** standard. 
- **Local Dev (DuckDB)**: We configured dbt to use DuckDB as its local engine. This gives us a lightning-fast, serverless analytical warehouse that lives right in the `scratch/` directory.
- **Production (AWS Athena)**: By utilizing dbt's adapter pattern, the same models we test locally will run over **AWS Athena** in production, querying the S3 data lake without any code changes.

**3. Frontend Screener Integration:**
We introduced a dedicated **Screener** tab to the dashboard. Built with our signature glassmorphic aesthetic, the screener provides a sortable, high-density table view of the QMJ metrics. High-quality assets are highlighted with green accents, providing a professional terminal experience for fundamental analysis.

**4. The .gitignore Hardening:**
As we added analytical databases (`.duckdb`) and virtual environments (`.logvenv`), we updated our `.gitignore` to ensure the repository remains lean and production-ready, ignoring all local analytical artifacts and debug scripts.

**Status:**
The engine is now a dual-threat platform: **Momentum Discovery** via LangGraph and **Quality Screening** via dbt. We have transitioned from a data aggregator to a full-stack analytical engine.

**What's Next?**
Phase 8: Multi-Agent Collaborative Refinement. We will be wiring these QMJ scores back into the Discovery Agent's decision-making node, allowing the AI to "self-filter" its own recommendations based on fundamental quality before they ever reach the user.

## Entry 38: The Alpha-DAG Pivot and Colima Networking

*Date: May 2026*

### From Monolith to Agentic Discovery

The transition from Phase 1 to Phase 3 represented a significant shift in how we handle financial intelligence. By moving to **LangGraph**, we replaced a brittle background loop with a stateful DAG that can handle complex multi-step reasoning.

The **Daily Discovery Agent** was the crowning achievement of this pivot. Instead of waiting for a user to track a ticker, the system now autonomously "hunts" for value at 8:00 AM every morning. By isolating quantitative math into a restricted **Quant MCP**, we've ensured that our most complex logic runs in a secure sandbox, while Bedrock handles the high-level synthesis only when our **FinOps Gate** confirms we are under budget.

### The Colima Networking Incident

**Problem:** After a successful `docker-compose up --build`, the dashboard was completely unreachable at `localhost:8000`. `curl` returned `Connection refused` even though `docker ps` showed the container as `healthy`. The `lsof -i :8000` command returned nothing — no process was listed as the owner of the port.

**Root Cause:** The project runs Docker via **Colima** (a lightweight macOS Docker runtime alternative to Docker Desktop). In Colima's default mode, it runs a Linux VM using Apple's Virtualization Framework without assigning it a host-bridged network interface. Port bindings like `0.0.0.0:8000->8000/tcp` are forwarded *inside* the Colima VM, but are not exposed to the macOS host network. This is why `localhost` and `127.0.0.1` both silently refused connections.

**Fix:** Restart Colima with the `--network-address` flag, which provisions a dedicated bridged network interface and assigns the VM a stable LAN IP:

```bash
colima stop
colima start --network-address
# Then check your IP:
colima list  # Shows ADDRESS column, e.g. 192.168.64.2
```

The dashboard is then accessible at `http://192.168.64.2:8000` (use your specific Colima IP).

**Lesson:** When debugging container connectivity issues on macOS, always check the Docker runtime first (`docker context ls`). If it points to a Colima socket, `localhost` port forwarding behaves differently than Docker Desktop.
