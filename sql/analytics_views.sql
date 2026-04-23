-- Shipal analytics views — dashboard-ready aggregates over shipal_analytics.events.
--
-- Apply idempotently:
--   bq query --project_id=<project> --use_legacy_sql=false < sql/analytics_views.sql
--
-- Every view is CREATE OR REPLACE so re-running is safe.
-- Each view is the direct source for a single dashboard chart (see docs/dashboard-setup.md).

-- 1) Daily counts split by outcome and event name.
--    Drives: time-series of tool calls, "events by status" breakdown.
CREATE OR REPLACE VIEW `projekt-twenty-crm.shipal_analytics.vw_events_daily` AS
SELECT
  DATE(ts) AS day,
  event_name,
  COALESCE(tool_status, 'unknown') AS tool_status,
  COUNT(*) AS events,
  COUNT(DISTINCT event_id) AS unique_events,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)] AS median_latency_ms,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)] AS p95_latency_ms
FROM `projekt-twenty-crm.shipal_analytics.events`
GROUP BY day, event_name, tool_status;

-- 2) user_intent distribution.
--    Drives: pie chart of why users are tracking.
CREATE OR REPLACE VIEW `projekt-twenty-crm.shipal_analytics.vw_user_intent_split` AS
SELECT
  DATE(ts) AS day,
  COALESCE(user_intent, 'unspecified') AS user_intent,
  COUNT(*) AS events
FROM `projekt-twenty-crm.shipal_analytics.events`
WHERE event_name = 'tool.track_package'
GROUP BY day, user_intent;

-- 3) Carrier distribution (successes only, to avoid skew from error rows
--    where the carrier field may be null or stale).
--    Drives: top-N carriers bar chart.
CREATE OR REPLACE VIEW `projekt-twenty-crm.shipal_analytics.vw_carrier_split` AS
SELECT
  DATE(ts) AS day,
  COALESCE(carrier, 'unknown') AS carrier,
  COUNT(*) AS events
FROM `projekt-twenty-crm.shipal_analytics.events`
WHERE event_name = 'tool.track_package'
  AND tool_status = 'ok'
GROUP BY day, carrier;

-- 4) Error breakdown (errors only).
--    Drives: error analysis table.
CREATE OR REPLACE VIEW `projekt-twenty-crm.shipal_analytics.vw_error_breakdown` AS
SELECT
  DATE(ts) AS day,
  COALESCE(error_code, 'unspecified') AS error_code,
  COUNT(*) AS events
FROM `projekt-twenty-crm.shipal_analytics.events`
WHERE tool_status = 'error'
GROUP BY day, error_code;

-- 5) Headline rollup — one row per day, everything a scorecard needs.
--    Drives: "tool calls today", "error rate", "median latency", "unique carriers".
CREATE OR REPLACE VIEW `projekt-twenty-crm.shipal_analytics.vw_headline_daily` AS
SELECT
  DATE(ts) AS day,
  COUNT(*) AS total_calls,
  COUNTIF(tool_status = 'error') AS errors,
  SAFE_DIVIDE(COUNTIF(tool_status = 'error'), COUNT(*)) AS error_rate,
  APPROX_QUANTILES(IF(tool_status = 'ok', latency_ms, NULL), 100)[OFFSET(50)] AS median_ok_latency_ms,
  COUNT(DISTINCT carrier) AS unique_carriers
FROM `projekt-twenty-crm.shipal_analytics.events`
GROUP BY day;
