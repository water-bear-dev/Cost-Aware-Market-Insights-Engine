{{ config(materialized='table') }}

WITH metrics AS (
    SELECT * FROM {{ ref('int_qmj_metrics') }}
),

stats AS (
    SELECT
        reporting_year,
        reporting_quarter,
        AVG(profitability_gpa) as avg_prof,
        STDDEV(profitability_gpa) as std_prof,
        AVG(leverage_ratio) as avg_lev,
        STDDEV(leverage_ratio) as std_lev,
        AVG(growth_yoy) as avg_growth,
        STDDEV(growth_yoy) as std_growth
    FROM metrics
    GROUP BY reporting_year, reporting_quarter
),

z_scores AS (
    SELECT
        m.*,
        CASE WHEN s.std_prof > 0 THEN (m.profitability_gpa - s.avg_prof) / s.std_prof ELSE 0 END AS z_prof,
        -- Safety is inverse of leverage, so lower leverage = higher safety (negative Z score of leverage)
        CASE WHEN s.std_lev > 0 THEN -(m.leverage_ratio - s.avg_lev) / s.std_lev ELSE 0 END AS z_safety,
        CASE WHEN s.std_growth > 0 THEN (m.growth_yoy - s.avg_growth) / s.std_growth ELSE 0 END AS z_growth,
        
        PERCENT_RANK() OVER (PARTITION BY m.reporting_year, m.reporting_quarter ORDER BY m.profitability_gpa ASC) * 100 AS prof_percentile,
        PERCENT_RANK() OVER (PARTITION BY m.reporting_year, m.reporting_quarter ORDER BY m.leverage_ratio DESC) * 100 AS safety_percentile,
        PERCENT_RANK() OVER (PARTITION BY m.reporting_year, m.reporting_quarter ORDER BY m.earnings_yield ASC) * 100 AS value_percentile,
        PERCENT_RANK() OVER (PARTITION BY m.reporting_year, m.reporting_quarter ORDER BY m.momentum ASC) * 100 AS momentum_percentile
    FROM metrics m
    JOIN stats s ON m.reporting_year = s.reporting_year AND m.reporting_quarter = s.reporting_quarter
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
    
    -- Final QMJ Composite (Profitability + Safety + Growth)
    ROUND((z_prof + z_safety + z_growth) / 3, 4) AS qmj_score,
    
    -- Academic Metrics
    ROUND(profitability_gpa, 4) AS profitability,
    ROUND(leverage_ratio, 4) AS leverage,
    ROUND(growth_yoy, 4) AS growth_yoy,
    ROUND(earnings_yield, 4) AS valuation,
    ROUND(momentum, 2) AS momentum,
    
    -- Z-Scores for UI
    ROUND(z_prof, 4) AS z_prof,
    ROUND(z_safety, 4) AS z_safety,
    ROUND(z_growth, 4) AS z_growth,
    
    -- Percentile Scores for UI
    ROUND(prof_percentile, 2) AS prof_percentile,
    ROUND(safety_percentile, 2) AS safety_percentile,
    ROUND(value_percentile, 2) AS value_percentile,
    ROUND(momentum_percentile, 2) AS momentum_percentile
FROM z_scores
ORDER BY report_date DESC, qmj_score DESC
