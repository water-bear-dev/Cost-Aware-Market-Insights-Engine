{{ config(materialized='view') }}

{% if target.name == 'dev' %}
  WITH raw_data AS (
    SELECT * FROM read_json_auto('../../scratch/bronze/financials/*.json')
  )
{% else %}
  -- Prod assumes the data is exposed via AWS Glue
  WITH raw_data AS (
    SELECT * FROM {{ source('awsdatacatalog', 'bronze_financials') }}
  )
{% endif %}

SELECT
    raw_data.ticker,
    raw_data.company_name,
    raw_data.exchange,
    raw_data.industry,
    raw_data.sector,
    TRY_CAST(raw_data.market_cap AS DOUBLE) AS market_cap,
    TRY_CAST(raw_data.momentum AS DOUBLE) AS momentum,
    TRY_CAST(raw_data.report_date AS DATE) AS report_date,
    TRY_CAST(raw_data.net_income AS DOUBLE) AS net_income,
    TRY_CAST(raw_data.gross_profit AS DOUBLE) AS gross_profit,
    TRY_CAST(raw_data.total_revenue AS DOUBLE) AS total_revenue,
    TRY_CAST(raw_data.total_assets AS DOUBLE) AS total_assets,
    TRY_CAST(raw_data.total_equity AS DOUBLE) AS total_equity,
    TRY_CAST(raw_data.total_debt AS DOUBLE) AS total_debt,
    TRY_CAST(raw_data.operating_cash_flow AS DOUBLE) AS operating_cash_flow
FROM raw_data
WHERE raw_data.ticker IS NOT NULL
