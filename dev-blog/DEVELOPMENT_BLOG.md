# Development Blog

A working document detailing engineering decisions, feature updates, and architectural pivots as the Cost-Aware Market Insights Engine evolves.

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

---
*Project Concluded - Managed by Antigravity*
