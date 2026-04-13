# Changelog: Cost-Aware Market Insights Engine

All notable changes to this project will be documented in this file.

## [1.0.1-HOTFIX] - 2026-04-13

### Fixed
- **Bedrock IAM Permissions**: Added `aws-marketplace:ViewSubscriptions`, `aws-marketplace:Subscribe`, and `aws-marketplace:Unsubscribe` to the ECS Task Role in `cloudformation.yml`. Bedrock internally validates these marketplace permissions when invoking Anthropic models, even though the Model Access subscription page has been retired. Without them the `InvokeModel` call threw `AccessDeniedException` for every ticker, resulting in the "Awaiting AI Synthesis" state persisting indefinitely.
- **Synthesis Resilience Fallback**: Added graceful degradation in `synthesis/service.py` — if Bedrock returns an `AccessDeniedException`, the engine now generates a data-driven market summary from live price/headline data instead of silently returning `False`. The UI always shows meaningful content while IAM propagates.

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
