# Shipal — Package Tracking in ChatGPT and Claude

Shipal is a ChatGPT App / Custom Claude Connector that looks up the current status of a parcel by tracking number through the [17Track](https://www.17track.net/) API. The user pastes a tracking number (or asks "where is X"), the connector calls 17Track, and a single widget renders the carrier, the canonical status, the latest event with a city-level location, the days in transit, the carrier's estimated delivery window when available, and a chronological event timeline.

The carrier is auto-detected from the tracking number — Shipal does not ask the user to pick one.

## Surfaces

- **ChatGPT Apps SDK** (web + mobile) — Skybridge widget rendered inside the chat.
- **Anthropic Custom Connectors** — Streamable HTTP MCP server, no-auth, `readOnlyHint: true`.

## Architecture

```
ChatGPT / Claude
       │  MCP (Streamable HTTP)
       ▼
shipal-mcp (Cloud Run, europe-west1)
   │
   ├─► 17Track API   ─── tracking lookup (server.ts → defaultFetchTracking)
   └─► yavio-analytics ── anonymous tool-call telemetry (analytics.ts → @yavio/analytics-sdk-server)
```

The repo is a single Skybridge project: `server/` is the MCP server, `web/src/widgets/` is the React widget, `website/` is the marketing/landing page (also served by the MCP host at `/`).

See [`SPEC.md`](./SPEC.md) for the product spec and the data shape of every returned field.

## Privacy

Shipal collects the minimum data needed to look up a parcel and aggregate anonymous usage metrics:

- **Sent to 17Track:** the tracking number you provide. Required to perform the lookup.
- **Returned to the chat:** carrier, status, latest event (with city-level location only — street addresses are scrubbed before returning), days in transit, ETA, and an event timeline. No sender or recipient addresses, customer numbers, reference numbers, or other identifiers from the carrier are exposed.
- **Sent to analytics (Yavio):** an anonymous event with the tool status (ok/error), the error code if any, the carrier name, the canonical status, the categorical `user_intent` bucket inferred by the LLM (e.g. `check_eta`, `worried_delay`), and latency. **No tracking number, no addresses, no free-text, no user identifiers.**

Full policy: [`/privacy`](https://shipal-18736126069.europe-west1.run.app/privacy) (also in `website/privacy.html`).

## Local development

Prerequisites: Node.js 24+, [pnpm](https://pnpm.io/), [ngrok](https://ngrok.com/) (only if testing inside a remote MCP host like ChatGPT or Claude.ai).

```bash
pnpm install
cp .env.example .env
# paste your SEVENTEEN_TRACK_API_KEY into .env
pnpm dev          # MCP at http://localhost:3000/mcp, DevTools UI at /
ngrok http 3000   # for use as a remote connector
```

Test instructions for ChatGPT and Claude.ai are in [`TESTING.md`](./TESTING.md).

## Deployment

Production runs on Google Cloud Run in `europe-west1`. See [`HOSTING.md`](./HOSTING.md) for the deploy runbook (Secret Manager bindings, Cloud Build trigger, env vars).

## Tests

```bash
pnpm test
```

Covers the 17Track error classifier, the location scrubber, the handler's PII regression (no `shipper_address`, `recipient_address`, `misc_info`, `customer_number`, `reference_number`, `local_number` at any depth in the response), and the error-path branches. The integration test against the real 17Track API runs only when `SEVENTEEN_TRACK_API_KEY` is set.

## Built with

- [Skybridge](https://docs.skybridge.tech/home) — MCP framework
- [Apps SDK UI](https://developers.openai.com/apps-sdk) — widget primitives
- [@yavio/analytics-sdk-server](https://github.com/teamyavio/yavio) — anonymous event telemetry
- [17Track API v2.2](https://api.17track.net/photos/docs/api/track.html) — carrier data
