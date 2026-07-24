# Hosting — Google Cloud Run

## Project

- **GCP Organization:** `yavio.ai` (id `284665811761`)
- **GCP Project:** `projekt-twenty-crm` (display name `joostmarcel`, project number `18736126069`)
- **Region:** `europe-west1`
- **Cloud Run service:** `shipal`
- **Service URL:** https://shipal-18736126069.europe-west1.run.app
- **Artifact Registry:** `europe-west1-docker.pkg.dev/projekt-twenty-crm/shipal/shipal`
- **Secret Manager:** `shipal-17track-key` (automatic replication); optionally `shipal-yavio-api-key` (Yavio analytics tenant API key, scope `write:events`)

## What gets deployed

The single Cloud Run service serves both:
- **Website** — Landing page at `GET /`
- **MCP Server** — Skybridge server for the ChatGPT App, exposing the `track-package` tool and widget, at `POST /mcp`
- **Health check** — `GET /health` returns `{"ok":true}` (renamed from `/healthz` because Cloud Run's Google Front-End reserves that path and returns its own 404 before requests reach the container)
- **OpenAI verification token** — `GET /.well-known/openai-apps-challenge`
- **Icon + logo** — `GET /assets/icon.svg` and `GET /logo.png`

## Environment variables / secrets

| Variable | Source | Description |
|---|---|---|
| `SEVENTEEN_TRACK_API_KEY` | Secret Manager (`shipal-17track-key:latest`) | 17Track API key for package tracking. The server refuses to boot without this. |
| `YAVIO_ENDPOINT` | Inline env var (**set this**) | Analytics ingest URL — `https://ingest.apps.yavio.ai/v1/events`. Must be set: `@yavio/sdk`'s built-in default (`https://ingest.yavio.ai`) does not resolve. Verified 2026-06-17 returning `200 {"accepted":N,"rejected":0}`. |
| `YAVIO_API_KEY` | Optional secret (`shipal-yavio-api-key:latest`) | Yavio project API key ("Marcels Workspace / Shipal Prod" in the Yavio dashboard, key prefix `yav_ac985489`). When unset, analytics is a silent no-op and a one-time warning is logged. |
| `YAVIO_INTENT` | Inline env var, `true` since 2026-07-24 | Enables `@yavio/sdk` user-intent capture: the `track-package` tool advertises a required `context` parameter (visible in `tools/list`), captured to the dashboard's Intents page. Schema change ⇒ ChatGPT app-store resubmission required (pending). |

> **Note (2026-07-24):** an earlier version of this file documented a "Yavio
> tenant identity" (tenant/app IDs, a BigQuery dataset, `tools/cli` tenant
> provisioning). That referred to the abandoned Cloud Run + BigQuery analytics
> variant, decommissioned 2026-07-22. Shipal reports to the self-hosted Yavio
> platform at `dashboard.apps.yavio.ai` (project **Shipal Prod** in Marcels
> Workspace).

`@yavio/sdk` logs `[yavio] Server-only mode: skipping _meta.yavio injection…` once at startup. If the key is wrong/rejected it logs `[YAVIO-1203] API key rejected — stopping delivery` on the first flush (and `[YAVIO-1200] Network error…` on an unreachable endpoint). No such error after a tool call means events are being accepted and delivered.

## Prerequisites on your machine

Tooling installed in `~/.local/bin` (already on `$PATH`):
- `gcloud` (Google Cloud SDK 565.0.0+)
- `docker-credential-gcloud` (symlinked from `~/google-cloud-sdk/bin/docker-credential-gcloud`)
- Docker Desktop (v29.1.3+)

`gcloud` requires Python ≥ 3.10. Workstation ships with 3.9 so we installed 3.12 via `uv` at `~/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12` and exported `CLOUDSDK_PYTHON` in `~/.zshenv`.

Authentication (one-time):
```
gcloud auth login                                           # browser OAuth
gcloud config set project projekt-twenty-crm
gcloud config set run/region europe-west1
gcloud config set artifacts/location europe-west1
gcloud auth configure-docker europe-west1-docker.pkg.dev --quiet
```

## Deploy

### Build and push the Docker image

```bash
SHA=$(git rev-parse --short HEAD)
REPO=europe-west1-docker.pkg.dev/projekt-twenty-crm/shipal/shipal

# Build for amd64 (Mac is arm64 by default)
docker build --platform linux/amd64 -t shipal:$SHA -t $REPO:$SHA -t $REPO:latest .

# Push both tags
docker push $REPO:$SHA
docker push $REPO:latest
```

Tagging by git short-hash gives us reproducible, rollback-able deploys. `:latest` is tagged for convenience but we deploy by SHA.

### Deploy to Cloud Run

```bash
SHA=$(git rev-parse --short HEAD)
IMAGE=europe-west1-docker.pkg.dev/projekt-twenty-crm/shipal/shipal:$SHA

gcloud run deploy shipal \
  --image "$IMAGE" \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 5 \
  --timeout 30s \
  --concurrency 1 \
  --update-env-vars "YAVIO_ENDPOINT=https://ingest.apps.yavio.ai/v1/events" \
  --update-secrets "SEVENTEEN_TRACK_API_KEY=shipal-17track-key:latest,YAVIO_API_KEY=shipal-yavio-api-key:latest"
```

For subsequent deploys you can often pass only `--image` — Cloud Run keeps the previous env vars / secrets / knobs.

### Rollback

```bash
gcloud run services describe shipal --region=europe-west1 \
  --format='value(status.traffic[].revisionName)'   # list revisions

gcloud run services update-traffic shipal \
  --to-revisions=<previous-revision-name>=100 --region=europe-west1
```

## One-time setup notes (already done)

### Org-policy exception for `allUsers`
`yavio.ai` has `iam.allowedPolicyMemberDomains` locked to the org's customer directory, which would block `--allow-unauthenticated` on Cloud Run. An exception was set at the project scope:

```bash
cat > /tmp/v2-policy.yaml <<'EOF'
name: projects/projekt-twenty-crm/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
EOF
gcloud org-policies set-policy /tmp/v2-policy.yaml --project=projekt-twenty-crm
```

Requires `roles/orgpolicy.policyAdmin` at the **org level**. A project Owner cannot set this alone.

### Artifact Registry + Secret Manager

```bash
# Registry
gcloud artifacts repositories create shipal \
  --repository-format=docker --location=europe-west1

# Secret
printf '%s' "<17track-key>" | gcloud secrets create shipal-17track-key --data-file=- --replication-policy=automatic

# Grant compute SA
PROJECT_NUMBER=18736126069
gcloud secrets add-iam-policy-binding shipal-17track-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud artifacts repositories add-iam-policy-binding shipal \
  --location=europe-west1 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

## Custom Domain (future work)

Map `shipal.yavio.de` once v1 is stable:

```bash
gcloud run domain-mappings create \
  --service shipal \
  --domain shipal.yavio.de \
  --region europe-west1
```

Then add the DNS CNAME record pointing to `ghs.googlehosted.com` at the `yavio.de` registrar. SSL provisioning takes ~15 min to a few hours.

## Analytics — Yavio Analytics tenant

Shipal ships anonymous tool-call events to Yavio Analytics via `@yavio/sdk` (the server is wrapped with `withYavio` in `server/src/analytics.ts`, in `serverOnly` mode with input/output/geo auto-capture disabled for privacy). The Shipal-side runbook is just "make sure `YAVIO_API_KEY` is bound to the Cloud Run service"; provisioning, dashboards, retention, and per-tenant views all live on the Yavio side.

To provision (one-time, in the yavio-analytics repo):

```bash
ROOT_API_KEY=<root-key> INGEST_URL=https://ingest.apps.yavio.ai \
  pnpm -C tools/cli dev tenant create "Shipal"
# capture the returned apiKey, store as Secret Manager: shipal-yavio-api-key
```

Per-app dashboard URL is `<yavio-dashboard>/t/<tenantId>/apps/<appId>` once events have arrived (60s lag).

## Gotchas

- **Reserved path**: Cloud Run's Google Front-End returns its own 404 for `/healthz` before requests reach the container. Use `/health` instead (or anything else).
- **Platform**: build `--platform linux/amd64` — Mac is arm64 by default and Cloud Run rejects arm64 images.
- **Python**: gcloud needs Python ≥ 3.10. System Python 3.9 crashes on some commands (e.g. `gcloud run deploy`).
- **Analytics**: best-effort. The server never fails a tool call if analytics is down; if `YAVIO_API_KEY` is unset, `@yavio/sdk` runs in no-op mode and `track()` does nothing. `@yavio/sdk` batches events on a ~10s interval and swallows network errors internally. One caveat: on `SIGTERM`, Skybridge's `server.run()` closes the HTTP server and `process.exit(0)`s as soon as connections drain, which can pre-empt the SDK's async final-batch flush — so the last sub-interval batch is best-effort on shutdown (see the comment in `server/src/index.ts`).
- **Concurrency**: Skybridge `1.x` creates a fresh stateless `StreamableHTTPServerTransport` per request (`connectStatelessTransport`), so the old `0.33.2` "`Error: Already connected to a transport`" race no longer applies and `--concurrency=1` is no longer required for correctness. Validate under load before raising `--concurrency`, since each instance still shares one `McpServer`.
