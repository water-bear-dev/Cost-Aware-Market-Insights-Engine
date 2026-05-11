{{ config(materialized='table') }}

WITH metrics AS (
    SELECT * FROM {{ ref('int_qmj_metrics') }}
),

ranked AS (
    SELECT 
        *,
        -- Score components (0-100 percentile)
        PERCENT_RANK() OVER (PARTITION BY reporting_year, reporting_quarter ORDER BY profitability_gpa ASC) * 100 AS prof_score,
        PERCENT_RANK() OVER (PARTITION BY reporting_year, reporting_quarter ORDER BY leverage_ratio DESC) * 100 AS safety_score,
        PERCENT_RANK() OVER (PARTITION BY reporting_year, reporting_quarter ORDER BY earnings_yield ASC) * 100 AS value_score,
        PERCENT_RANK() OVER (PARTITION BY reporting_year, reporting_quarter ORDER BY momentum ASC) * 100 AS momentum_score
    FROM metrics
)

SELECT
    ticker,
    company_name,
    exchange,
    industry,
    sector,
    report_date,
    reporting_quarter,
    reporting_year,
    market_cap,
    -- Final QMJ Composite (Profitability + Safety)
    ROUND((prof_score + safety_score) / 2, 2) AS qmj_score,
    -- Academic Metrics
    ROUND(profitability_gpa, 4) AS profitability,
    ROUND(leverage_ratio, 4) AS leverage,
    ROUND(earnings_yield, 4) AS valuation,
    ROUND(momentum, 2) AS momentum,
    -- Percentile Scores for UI
    ROUND(prof_score, 2) AS prof_percentile,
    ROUND(safety_score, 2) AS safety_percentile,
    ROUND(value_score, 2) AS value_percentile,
    ROUND(momentum_score, 2) AS momentum_percentile
FROM ranked
ORDER BY report_date DESC, qmj_score DESC
