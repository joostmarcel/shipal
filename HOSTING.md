# Hosting — Google Cloud Run

## Project

- **GCP Organization:** `yavio.ai` (id `284665811761`)
- **GCP Project:** `projekt-twenty-crm` (display name `joostmarcel`, project number `18736126069`)
- **Region:** `europe-west1`
- **Cloud Run service:** `shipal`
- **Service URL:** https://shipal-18736126069.europe-west1.run.app
- **Artifact Registry:** `europe-west1-docker.pkg.dev/projekt-twenty-crm/shipal/shipal`
- **Secret Manager:** `shipal-17track-key` (automatic replication); optionally `shipal-analytics-key`

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
| `SHIPAL_ANALYTICS_ENDPOINT` | Inline env var | Analytics ingest URL. Default `https://yavio.ai/shipal/events`. |
| `SHIPAL_ANALYTICS_KEY` | Optional secret | Bearer token for the analytics ingest. When unset, analytics is a silent no-op (fine for v1). |

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
  --concurrency 80 \
  --set-env-vars "SHIPAL_ANALYTICS_ENDPOINT=https://yavio.ai/shipal/events" \
  --update-secrets "SEVENTEEN_TRACK_API_KEY=shipal-17track-key:latest"
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

## Analytics — Dashboard bootstrap

The 5 BigQuery views that back the Looker Studio dashboard live in [`sql/analytics_views.sql`](sql/analytics_views.sql). They're idempotent — re-running is safe.

Apply to a fresh environment:
```bash
bq query --project_id=projekt-twenty-crm --use_legacy_sql=false < sql/analytics_views.sql
```

Dashboard setup instructions (including the one-click Looker Studio Linking URL that pre-wires all 5 data sources) are in [`docs/dashboard-setup.md`](docs/dashboard-setup.md).

The design doc for evolving this prototype into a client-facing multi-tenant pipeline lives in [`docs/analytics-pipeline.md`](docs/analytics-pipeline.md).

## Gotchas

- **Reserved path**: Cloud Run's Google Front-End returns its own 404 for `/healthz` before requests reach the container. Use `/health` instead (or anything else).
- **Platform**: build `--platform linux/amd64` — Mac is arm64 by default and Cloud Run rejects arm64 images.
- **Python**: gcloud needs Python ≥ 3.10. System Python 3.9 crashes on some commands (e.g. `gcloud run deploy`).
- **Analytics**: best-effort. The server never fails a tool call if analytics is down; if `SHIPAL_ANALYTICS_KEY` is unset, `track()` is a logged no-op.
