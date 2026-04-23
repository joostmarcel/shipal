# Analytics Pipeline — Engineering Design

**Status:** Draft · internal engineering only · no marketing / pricing / GTM content.
**Authors:** Shipal team
**Last updated:** 2026-04-23

## 1. Summary

Shipal (a ChatGPT Apps SDK integration for package tracking) is running in production on Google Cloud Run and emitting usage events into a minimal first-party analytics pipeline: `shipal` → POST `/v1/events` → `shipal-ingest` → BigQuery → Looker Studio. This document captures the prototype accurately, lists the gaps that separate it from a multi-tenant pipeline we could run for other clients, and describes the target v1 productized architecture plus a migration path that keeps every step independently shippable.

We deliberately keep the name "Shipal" for the current prototype and treat the productized version as a separate product ("yavio-analytics" as a working name). No code in this doc.

## 2. Current prototype

### 2.1 Architecture

```
┌─────────────────┐  fire-and-forget           ┌────────────────────┐
│  shipal         │  POST /v1/events           │  shipal-ingest     │
│  Cloud Run      │  Authorization: Bearer …   │  Cloud Run         │
│  server/src/    │ ─────────────────────────► │  ingest/src/       │
│  analytics.ts   │                            │  server.ts         │
└─────────────────┘                            └──────────┬─────────┘
                                                          │ BigQuery
                                                          │ streaming insert
                                                          ▼
                                           ┌──────────────────────────┐
                                           │ BigQuery                 │
                                           │ shipal_analytics.events  │
                                           │ + 5 aggregate views      │
                                           └──────────┬───────────────┘
                                                      │
                                                      ▼
                                           Looker Studio (free)
```

Both services live in GCP project `projekt-twenty-crm` (org: yavio.ai), region `europe-west1`, scale-to-zero. Cost at launch volume: roughly zero — BigQuery stores sub-gigabyte data, Cloud Run invocations fit inside the free tier.

### 2.2 Data plane — wire format

The client (currently only `server/src/analytics.ts` inside the Shipal MCP server) POSTs JSON to the ingest:

```
POST /v1/events HTTP/1.1
Authorization: Bearer <32-byte hex>
Content-Type: application/json

{
  "events": [
    {
      "event_id":           "uuid",
      "ts":                 "ISO-8601",
      "event_name":         "tool.track_package",
      "source":             "server" | "widget",
      "app_version":        "0.1.0",
      "tool_status":        "ok" | "error",
      "error_code":         "not_found" | "rate_limited" | ...,
      "carrier":            "DHL Paket",
      "status":             "Delivered",
      "user_intent":        "check_eta",
      "user_intent_detail": "gift for Friday",
      "latency_ms":         842
    }
  ],
  "sdk_version": "shipal-0.1",
  "sent_at":     "ISO-8601"
}
```

The batch envelope matches the [@yavio/sdk](https://github.com/teamyavio/yavio) wire format exactly, so swapping our stub for `withYavio(server, { endpoint })` later is a one-import change.

### 2.3 Control plane

There is none. One bearer key, stored in Secret Manager (`shipal-ingest-key`), shared between producer (Shipal) and consumer (`shipal-ingest`). No workspace, tenant, or user concept exists in the ingest.

### 2.4 Storage schema

Single wide table `shipal_analytics.events`, partitioned by `DATE(ts)`, clustered by `(event_name, user_intent)`. Notable columns: `event_id` (dedupe key), `ts`, `ingested_at` (wall time when the row was written), the aggregate signal fields listed above, plus `raw_event` (JSON) as a forward-compat escape hatch.

A view layer in `sql/analytics_views.sql` aggregates to per-day granularity for the Looker Studio dashboard.

### 2.5 Operational posture

| Concern | Status |
|---|---|
| Availability target | None declared. Both services are scale-to-zero; cold-start latency acceptable because analytics is fire-and-forget. |
| Latency budget on producer | 2-second `AbortSignal.timeout` in `analytics.ts`; analytics never blocks a tool call. |
| Authentication | Single shared bearer via Secret Manager. |
| Authorization | None beyond bearer match. |
| Rate limiting | None (Cloud Run `max-instances=5` bounds abuse cost rather than enforcing per-caller limits). |
| PII guard | Recursive walk in `ingest/src/server.ts` that refuses any event whose payload carries a reserved key (`tracking_number`, `shipper_address`, `recipient_address`, `misc_info`, `customer_number`, `reference_number`, `local_number`). Returns HTTP 422. |
| Data retention | BigQuery default (unlimited). |
| Observability | Cloud Run stdout logs; no tracing; Fastify structured logs on ingest. |
| Cost attribution | None. |

## 3. Gaps to productization

Each section below is ~half a page; together they are the reason a "just swap the bearer" approach wouldn't work for a second client.

### 3.1 Tenancy

One bearer. One BigQuery table. One project. The moment a second client ships events, we'd either mix their data into ours (privacy blast radius), hand them a second copy of the full stack (operational sprawl), or stand up per-client projects (billing fan-out). None scales.

**Target** — a `tenant_id` partition in every event row; per-tenant BigQuery datasets (keeps IAM clean); one shared Cloud Run ingest that looks up tenant by bearer and routes.

### 3.2 Authentication & key management

Today the key is a single 32-byte hex generated at provisioning time, stored in Secret Manager, and shared by reference. There is no:

- Rotation procedure (rotating today means: generate new key, update both secret versions, pin both services to `:latest`).
- Revocation (no way to disable a compromised key without rotating all keys).
- Scoped keys (write-only vs admin).
- Per-key rate limits.

**Target** — `api_keys` table in a small control-plane database. Bearer is an opaque ID whose hash is looked up; the row records tenant_id, scopes, rate_limit_per_minute, expires_at, revoked_at. Rotation and revocation become one-row UPDATEs.

### 3.3 Schema evolution

The events table has an explicit column set, plus `raw_event` JSON for fields we haven't surfaced yet. That works as a runway, but not as a contract:

- No explicit schema version on the wire.
- No registry of what fields are "official" vs "extra".
- No dev-time validation for producers outside our own codebase.

**Target** — publish the event schema as a versioned JSON Schema document (`schemas/v1/tool_call.json`), include `schema_version` at the batch envelope level, and have the ingest reject or warn on unknown versions.

### 3.4 Data retention & GDPR

We store nothing user-identifying today. The moment a client pipeline ingests anything keyable to a person (user_id, session_id, IP, email hash), we inherit obligations:

- Right to erasure (Art. 17): needs a row-level delete flow keyed to the identifying column.
- Right to export (Art. 20): needs a per-subject dump endpoint.
- Retention limit: BigQuery has no built-in row TTL; we'd use partition-level expiration and scheduled deletes.

**Target** — from day one of the productized version, make the schema nullable on every identifying column and require clients to opt-in per field. Default retention: 90 days, with an overridable per-tenant setting. Expose a documented erase endpoint that issues DML DELETE against the tenant's dataset.

### 3.5 Reliability & SLA

Cloud Run streaming inserts to BigQuery have a documented best-effort availability, not an SLA we can underwrite. The ingest itself is a single Cloud Run service, single region, scale-to-zero. Cold starts on the first call after idle can push p99 up.

**Target** — define explicit SLOs (e.g. availability 99.5%, p95 ingest latency < 500ms), instrument with a `sli` table in BigQuery fed by periodic probes, declare an error budget. Multi-region comes later; first improvement is min-instances=1 for the ingest on paid tiers.

### 3.6 Dashboard provisioning

We hand our one internal user a Looker Studio Linking API URL. For clients we'd want:

- Per-tenant dashboards (so tenants can't see each other's data).
- Reasonable default visualizations per event schema.
- Embeddable mode (iframe in a client portal) rather than Looker Studio's own URL.

**Target v1** — still Looker Studio, but generate the Linking URL server-side per tenant, wiring only that tenant's dataset. Embed is a post-v1 concern; it moves us toward building our own React dashboard, which is a much bigger project.

### 3.7 Cost attribution

We don't know, per tenant, how much BigQuery storage or query cost their pipeline incurs. Without this we can't bill, throttle, or warn on misuse.

**Target** — BigQuery offers labels on datasets/tables; we label every tenant dataset with `tenant_id=<id>` and use Billing's export-to-BigQuery feature to aggregate cost per tenant daily.

## 4. Target architecture — v1 productized

Not the end state. A realistic first iteration that lets us onboard tenant #2 without regretting it.

### 4.1 Services

```
              ┌────────────────────┐
  clients ──► │  yavio-ingest      │  Cloud Run, shared across tenants
              │  (renamed from    │  Fastify + BigQuery streaming insert
              │  shipal-ingest)   │  Bearer lookup hits control plane
              └──┬─────────────┬───┘
                 │             │
                 │ BigQuery    │ Cloud SQL (Postgres, small)
                 ▼             ▼
       ┌──────────────────┐ ┌─────────────────┐
       │ tenant_a.events  │ │ tenants         │
       │ tenant_a.vw_*    │ │ api_keys        │
       │ tenant_b.events  │ │ scopes          │
       │ tenant_b.vw_*    │ │ usage_daily     │
       └──────────────────┘ └─────────────────┘
                              (control plane)
```

### 4.2 Control-plane schema (Postgres)

```
tenants (id, name, created_at, retention_days, plan, suspended_at)
api_keys (id, tenant_id, hash, scopes, created_at, expires_at, revoked_at,
          rate_limit_per_min)
usage_daily (tenant_id, day, events_accepted, events_rejected, bytes_ingested)
```

Small instance (`db-f1-micro` on Cloud SQL) because the control plane sees one lookup per POST /v1/events — and we cache in-process for N seconds.

### 4.3 Data plane — unchanged wire format

The SDK stays compatible. New envelope fields:

- `schema_version` (required once we publish a JSON Schema registry)
- Optional `trace_id` / `session_id` (client-chosen) for funnels later

### 4.4 Dashboard provisioning

One server-side endpoint: `POST /v1/admin/tenants/:id/dashboard`. Returns a Looker Studio Linking URL scoped to that tenant's dataset. Tenant admin clicks it, becomes the dashboard owner, shares with their team. We never own the report — the tenant does.

Embeddable dashboards via iframe: a v2 consideration that forces us to build our own UI. Out of scope for v1.

## 5. Migration from prototype

Each step is independently shippable and, if we stop after any of them, we still have a working Shipal.

**Step 1 — Tenant-ize the existing table (no new services).**
Add a `tenant_id STRING` column to `shipal_analytics.events`. Backfill with `'shipal'`. Views grow a `WHERE tenant_id = @tenant_id` clause or stay shared for our own use.

**Step 2 — Introduce `resolveTenant(bearer) → tenant_id` in the ingest.**
Start with an in-memory map hard-coded to `{ "<current-key>": "shipal" }`. No DB yet.

**Step 3 — Publish v1 schema.**
Drop a `schemas/v1/tool_call.json` JSON Schema alongside the code. The ingest starts warning on unknown schema_version values.

**Step 4 — Onboard tenant #2 without a control plane.**
Provision by: generate key, add to `resolveTenant` map, create their BigQuery dataset, hand them a Linking URL. This is the minimum viable multi-tenant config.

**Step 5 — Add the control plane only when tenant #3 appears.**
Stand up a small Cloud SQL Postgres. Move `resolveTenant` to DB-backed with a 5-second in-process cache. Add `/v1/admin/*` endpoints.

**Step 6 — Retention policy.**
Add partition expiration policies per tenant dataset. Default 90 days, overridable per tenant.

**Step 7 — Erase endpoint.**
Implement the GDPR erase flow: `POST /v1/erase` taking `tenant_id` + `subject_key` + `subject_value`, issuing DML DELETE.

Each step is 1-3 days of work.

## 6. Proposed API surface

All under the ingest service. Bearer scopes differ per route.

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/v1/events` | `write:events` | Accept a batch of events, write to the caller's tenant dataset. (Current endpoint.) |
| GET | `/v1/tenants/me` | any | Confirm the bearer, return tenant_id + plan. |
| POST | `/v1/admin/tenants` | `admin:root` | Create a new tenant (new dataset, new starter API key). |
| POST | `/v1/admin/tenants/:id/keys` | `admin:tenant` | Issue a new scoped key for an existing tenant. |
| DELETE | `/v1/admin/keys/:id` | `admin:tenant` | Revoke a key. |
| POST | `/v1/admin/tenants/:id/dashboard` | `admin:tenant` | Return a pre-wired Looker Studio Linking URL. |
| POST | `/v1/erase` | `admin:tenant` | GDPR erasure DML targeting a specific subject. |

## 7. Open questions

Captured here as explicit unknowns so we don't pretend they're resolved.

1. **Control-plane database.** Cloud SQL Postgres is the comfortable default. Firestore would scale to zero and remove one admin surface, but querying and migrations are worse. Decision: Postgres unless we find a strong Firestore-only reason.
2. **Write-through vs queued ingest.** Today we directly stream-insert in the request handler. If BigQuery is temporarily unavailable, the client's POST fails. Options: (a) keep as-is and rely on producer retry, (b) front the insert with Cloud Pub/Sub for durability. (b) adds a component; (a) is fine as long as client-side retry is disciplined. Decision deferred until we actually see streaming-insert outages.
3. **SDK client.** Keep our stub `analytics.ts` and tell partners to hand-write their HTTP client, or redirect them to `@yavio/sdk`? The SDK has auto-instrumentation we'd otherwise have to write, but is alpha. Revisit after Shipal v1 is approved on the OpenAI store.
4. **Multi-region.** EU-only for data-residency-sensitive tenants is a hard requirement we will eventually hit. BigQuery datasets are regional; datasets can be pinned `EU` multi-region which covers most cases. Cloud Run regional.
5. **Embeddable dashboards.** Looker Studio embeds are possible but crude. If a tenant wants a dashboard inside their own product, we're either exposing a Looker Studio iframe or building our own React dashboard on top of the view layer. Scope call, not a technical one.
6. **Dashboard ownership transfer.** When we generate a report via Linking API, the first viewer becomes the owner. If we want to retain ownership (for support), we need a service account to own it, which Looker Studio doesn't support well. Workaround: shared Drive.

## 8. References

- Shipal source: this repository.
- Shipal ingest service: [`ingest/src/server.ts`](../ingest/src/server.ts).
- Yavio SDK (wire format reference): https://github.com/teamyavio/yavio
- 17Track v2.2 API: https://api.17track.net/photos/docs/api/track.html
- BigQuery streaming insert quotas: https://cloud.google.com/bigquery/quotas#streaming_inserts
- BigQuery table expiration: https://cloud.google.com/bigquery/docs/best-practices-storage#use_the_expiration_settings_to_remove_unneeded_tables_and_partitions
- Looker Studio Linking API: https://developers.google.com/looker-studio/integrate/linking-api
- GDPR Art. 17 — right to erasure: https://gdpr-info.eu/art-17-gdpr/
- GDPR Art. 20 — right to portability: https://gdpr-info.eu/art-20-gdpr/
