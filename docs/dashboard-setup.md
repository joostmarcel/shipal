# Shipal usage dashboard — setup

A one-click Looker Studio dashboard sitting on top of the BigQuery view layer defined in [`sql/analytics_views.sql`](../sql/analytics_views.sql).

## Prerequisites

- BigQuery views already live in `projekt-twenty-crm.shipal_analytics`. (Run `bq query --use_legacy_sql=false < sql/analytics_views.sql` if starting from a fresh dataset.)
- A Google account with at least READER role on the dataset. Joost already has OWNER; to add someone, `bq update --source ...` with a new access entry, or use the BigQuery console.

## One-click data-source wiring

Click this link — it opens Looker Studio with all 5 data sources pre-configured:

```
https://lookerstudio.google.com/reporting/create?c.reportName=Shipal+%E2%80%94+Usage&ds.headline.connector=bigQuery&ds.headline.type=TABLE&ds.headline.projectId=projekt-twenty-crm&ds.headline.datasetId=shipal_analytics&ds.headline.tableId=vw_headline_daily&ds.headline.datasourceName=vw_headline_daily&ds.events.connector=bigQuery&ds.events.type=TABLE&ds.events.projectId=projekt-twenty-crm&ds.events.datasetId=shipal_analytics&ds.events.tableId=vw_events_daily&ds.events.datasourceName=vw_events_daily&ds.intent.connector=bigQuery&ds.intent.type=TABLE&ds.intent.projectId=projekt-twenty-crm&ds.intent.datasetId=shipal_analytics&ds.intent.tableId=vw_user_intent_split&ds.intent.datasourceName=vw_user_intent_split&ds.carrier.connector=bigQuery&ds.carrier.type=TABLE&ds.carrier.projectId=projekt-twenty-crm&ds.carrier.datasetId=shipal_analytics&ds.carrier.tableId=vw_carrier_split&ds.carrier.datasourceName=vw_carrier_split&ds.errors.connector=bigQuery&ds.errors.type=TABLE&ds.errors.projectId=projekt-twenty-crm&ds.errors.datasetId=shipal_analytics&ds.errors.tableId=vw_error_breakdown&ds.errors.datasourceName=vw_error_breakdown
```

Reference: [Looker Studio Linking API](https://developers.google.com/looker-studio/integrate/linking-api).

On first click Google will ask you to authorize the BigQuery connector. Accept. You'll land on a blank report canvas with 5 data sources already attached in the right-hand Data panel.

## Chart recipes

Every chart uses one of the pre-aggregated views, so **no calculated fields are needed** — just drag the named fields.

| # | Chart | Source view | Dimension | Metric | Notes |
|---|---|---|---|---|---|
| 1 | **Scorecard** ×3 | `vw_headline_daily` | — | `SUM(total_calls)`, `AVG(error_rate)` (display as %), `AVG(median_ok_latency_ms)` (display "ms") | Pin at top in a row of three |
| 2 | **Time series** | `vw_events_daily` | `day` | `SUM(events)` | Secondary dimension: `tool_status` for ok/error stack |
| 3 | **Pie chart** | `vw_user_intent_split` | `user_intent` | `SUM(events)` | Default date range: last 30 days |
| 4 | **Horizontal bar** | `vw_carrier_split` | `carrier` | `SUM(events)` | Sort metric desc, limit 10 |
| 5 | **Table** | `vw_error_breakdown` | `error_code` | `SUM(events)` | Sort metric desc |

## Polish

- Rename the report: top-left title → `Shipal — Usage`.
- Default date range: Page → Page settings → Date range → **Last 30 days**.
- Share: top-right Share → `contact@yavio.ai` as Editor (and any teammate).

## Live-data verification

After one real ChatGPT tool call (`@Shipal track 00340434450341490075`):

1. Wait ~30 s for Looker Studio's cache to pick up the new row.
2. "Total calls" scorecard should increment.
3. The user_intent pie picks up whatever intent ChatGPT classified that call as.
4. BigQuery cross-check: `bq query --use_legacy_sql=false 'SELECT ts, event_name, user_intent, tool_status FROM shipal_analytics.events ORDER BY ts DESC LIMIT 5'`.

## When to refactor

The current setup hard-codes dataset/project in every view. If we ever have multiple datasets (see [`analytics-pipeline.md`](analytics-pipeline.md)), move to parameterized views or deploy per-tenant copies.
