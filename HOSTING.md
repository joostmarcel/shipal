# Hosting — Google Cloud Run

## Project

- **GCP Project:** `yavio-mcp-apps-hosting`
- **Region:** `europe-west1`
- **Service Name:** `yavio-shipal` (kept as-is; renaming the service would require recreation)
- **Service URL:** https://yavio-shipal-845670131694.europe-west1.run.app
- **Artifact Registry:** `europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal`

## What gets deployed

The single Cloud Run service serves both:
- **Website** — Landing page at `GET /`
- **MCP Server** — Skybridge server for the ChatGPT App, exposing the `track-package` tool and widget
- **Health check** — `GET /healthz` returns `{"ok":true}`
- **OpenAI verification token** — `GET /.well-known/openai-apps-challenge`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SEVENTEEN_TRACK_API_KEY` | yes | 17Track API key for package tracking. The server refuses to boot without this. |
| `SHIPAL_ANALYTICS_ENDPOINT` | no | Analytics ingest URL. Defaults to `https://yavio.ai/shipal/events`. |
| `SHIPAL_ANALYTICS_KEY` | no | Bearer token for the analytics ingest. When unset, analytics is a silent no-op (local dev works without it). |

## Deploy

### Build and push the Docker image

```bash
# Build for amd64 (required by Cloud Run)
docker build --platform linux/amd64 -t yavio-shipal-amd64 .

# Tag for Artifact Registry
docker tag yavio-shipal-amd64 europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal:latest

# Push
docker push europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal:latest
```

### Deploy to Cloud Run

```bash
gcloud run deploy yavio-shipal \
  --image europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal:latest \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars="SEVENTEEN_TRACK_API_KEY=<api-key>,SHIPAL_ANALYTICS_ENDPOINT=https://yavio.ai/shipal/events,SHIPAL_ANALYTICS_KEY=<analytics-key>" \
  --port 8080
```

Recommended for production: move secrets to Secret Manager and reference them via `--update-secrets` instead of `--set-env-vars`, and deploy by image digest rather than `:latest` for reproducible rollouts.

### One-time setup (already done)

```bash
# Authenticate Docker with Artifact Registry
gcloud auth configure-docker europe-west1-docker.pkg.dev

# Grant storage access for Cloud Build
gcloud projects add-iam-policy-binding yavio-mcp-apps-hosting \
  --member="serviceAccount:845670131694-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

## Custom Domain

To map a custom domain (e.g. `shipal.yavio.de`):

```bash
gcloud run domain-mappings create \
  --service yavio-shipal \
  --domain shipal.yavio.de \
  --region europe-west1
```

Then add the DNS CNAME record pointing to `ghs.googlehosted.com` at your domain registrar.

## Notes

- Docker image must be built with `--platform linux/amd64` (Mac uses ARM by default).
- The org policy on this GCP project blocks `allUsers` IAM bindings — public access requires either changing the org policy or using a Load Balancer.
- Analytics is best-effort: the MCP server never fails a tool call because analytics is down.
