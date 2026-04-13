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

---
*Project Concluded - Managed by Antigravity*

