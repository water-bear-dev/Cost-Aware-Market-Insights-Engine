{{ config(materialized='view') }}

WITH base AS (
    SELECT * FROM {{ ref('stg_financials') }}
),
with_lag AS (
    SELECT
        *,
        LAG(total_revenue, 1) OVER (PARTITION BY ticker ORDER BY report_date ASC) as prev_revenue,
        LAG(gross_profit, 1) OVER (PARTITION BY ticker ORDER BY report_date ASC) as prev_gross_profit
    FROM base
)

SELECT
    ticker,
    company_name,
    exchange,
    industry,
    sector,
    market_cap,
    momentum,
    report_date,
    -- Calendar Quarter grouping
    EXTRACT(QUARTER FROM report_date) AS reporting_quarter,
    EXTRACT(YEAR FROM report_date) AS reporting_year,
    
    -- QMJ Profitability: Gross Profits / Total Assets (Standard QMJ Paper)
    CASE 
        WHEN total_assets > 0 THEN gross_profit / total_assets 
        ELSE NULL 
    END AS profitability_gpa,
    
    -- ROE as secondary profitability
    CASE 
        WHEN total_equity > 0 THEN net_income / total_equity 
        ELSE NULL 
    END AS return_on_equity,

    -- Safety: Leverage (Total Debt / Total Equity) - Standard QMJ Paper
    CASE 
        WHEN total_equity > 0 THEN total_debt / total_equity 
        ELSE 0 
    END AS leverage_ratio,

    -- Value: Earnings Yield (Net Income / Market Cap) as proxy for B/P
    CASE 
        WHEN market_cap > 0 THEN net_income / market_cap 
        ELSE NULL 
    END AS earnings_yield,
    
    -- Growth: YoY Growth in Gross Profit (fallback to Revenue)
    CASE
        WHEN prev_gross_profit > 0 THEN (gross_profit - prev_gross_profit) / prev_gross_profit
        WHEN prev_revenue > 0 THEN (total_revenue - prev_revenue) / prev_revenue
        ELSE NULL
    END AS growth_yoy

FROM with_lag
WHERE report_date IS NOT NULL
