# Hosting - Google Cloud Run

## Project

- **GCP Project:** `yavio-mcp-apps-hosting`
- **Region:** `europe-west1`
- **Service Name:** `yavio-shipal`
- **Service URL:** https://yavio-shipal-845670131694.europe-west1.run.app
- **Artifact Registry:** `europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal`

## What gets deployed

The single Cloud Run service serves both:
- **Website** — Landing page at `GET /`
- **MCP Server** — Skybridge server for the ChatGPT App

## Environment Variables

| Variable | Description |
|---|---|
| `SEVENTEEN_TRACK_API_KEY` | 17Track API key for package tracking |
| `YAVIO_API_KEY` | Yavio project API key (from the self-hosted dashboard) |
| `YAVIO_ENDPOINT` | Yavio ingestion URL, e.g. `https://yavio.example.com:3001/v1/events` |

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
  --set-env-vars="SEVENTEEN_TRACK_API_KEY=<your-api-key>,YAVIO_API_KEY=<your-yavio-key>,YAVIO_ENDPOINT=https://ingest-shipal.apps.yavio.ai/v1/events" \
  --port 8080
```

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

## Yavio Analytics Platform (self-hosted on GCE)

The Yavio platform runs on a single GCE VM in europe-west1 via Docker Compose.

- **Instance type:** e2-medium (2 vCPU, 4 GB RAM)
- **Disk:** 50 GB SSD (pd-ssd)
- **OS:** Debian 12 or Ubuntu 24.04 with Docker
- **Cost:** ~$30-35/month
- **Services:** PostgreSQL, ClickHouse, Ingest API, Dashboard

### 1. Create the VM

```bash
gcloud compute instances create yavio-analytics \
  --project=yavio-mcp-apps-hosting \
  --zone=europe-west1-b \
  --machine-type=e2-medium \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-ssd \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=yavio-analytics
```

### 2. Open firewall ports

```bash
gcloud compute firewall-rules create yavio-allow-ingest \
  --project=yavio-mcp-apps-hosting \
  --allow=tcp:3001 \
  --target-tags=yavio-analytics \
  --source-ranges=0.0.0.0/0 \
  --description="Yavio ingest API"

gcloud compute firewall-rules create yavio-allow-dashboard \
  --project=yavio-mcp-apps-hosting \
  --allow=tcp:3000 \
  --target-tags=yavio-analytics \
  --source-ranges=0.0.0.0/0 \
  --description="Yavio dashboard"
```

### 3. Install Docker on the VM

```bash
gcloud compute ssh yavio-analytics --zone=europe-west1-b --project=yavio-mcp-apps-hosting

# On the VM:
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

### 4. Deploy the Yavio platform

```bash
# Clone the project onto the VM
git clone <your-repo-url> yavio-package-tracking
cd yavio-package-tracking

# Pull the Yavio submodule
git submodule update --init

# Generate secrets
./scripts/setup-env.sh

# Update .env with production URLs
# Replace NEXTAUTH_URL and APP_URL with the VM's external IP or domain:
#   NEXTAUTH_URL=http://<VM_EXTERNAL_IP>:3000
#   APP_URL=http://<VM_EXTERNAL_IP>:3000

# Start all services
docker compose up -d
```

### 5. Connect the ChatGPT app to Yavio

1. Get the VM's external IP: `gcloud compute instances describe yavio-analytics --zone=europe-west1-b --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`
2. Open the dashboard at `http://<VM_IP>:3000`
3. Register, create a workspace and project, copy the API key
4. Redeploy Cloud Run with the Yavio env vars:

```bash
gcloud run deploy yavio-shipal \
  --image europe-west1-docker.pkg.dev/yavio-mcp-apps-hosting/cloud-run-source-deploy/yavio-shipal:latest \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars="SEVENTEEN_TRACK_API_KEY=<key>,YAVIO_API_KEY=<yavio-key>,YAVIO_ENDPOINT=http://<VM_IP>:3001/v1/events" \
  --port 8080
```

### Services

| Service | Port | Description |
|---|---|---|
| Dashboard | 3000 | Analytics UI — create workspace, project, and API key here |
| Ingest | 3001 | Receives events from the SDK (`/v1/events`) |
| PostgreSQL | 5432 | Application database (internal only) |
| ClickHouse | 8123 | Analytics database (internal only) |

### Updating

```bash
gcloud compute ssh yavio-analytics --zone=europe-west1-b --project=yavio-mcp-apps-hosting
cd yavio-package-tracking
git pull && git submodule update --remote
docker compose up -d --build
```

## Notes

- Docker image must be built with `--platform linux/amd64` (Mac uses ARM by default)
- The org policy on this GCP project blocks `allUsers` IAM bindings — public access requires either changing the org policy or using a Load Balancer
