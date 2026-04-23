# Testing Shipal in ChatGPT

Local smoke test against real 17Track data via an ngrok tunnel.

## One-time setup

1. Install deps: `pnpm install`.
2. Install ngrok (binary on PATH) and authenticate:
   ```
   ngrok config add-authtoken <your-token>
   ```
3. Copy env: `cp .env.example .env`, then paste your 17Track key:
   ```
   SEVENTEEN_TRACK_API_KEY=<key>
   ```
   Leave `SHIPAL_ANALYTICS_KEY` blank — analytics becomes a no-op, which is fine for testing.

## Run

In two terminals:

```
pnpm dev              # MCP at http://localhost:3000/mcp, DevTools at /
ngrok http 3000       # copy the https://*.ngrok-free.app URL
```

Smoke-test the tunnel:

```
curl $NGROK/health                                    # {"ok":true}
curl $NGROK/.well-known/openai-apps-challenge         # 7GfhhbWTu5XtqH_hsZq8REfBcNXJJW2ywnqmrIogwNM
```

## Connect ChatGPT

1. [Apps Settings](https://chatgpt.com/apps#settings/Connectors) → **Create App**
2. Name: `Shipal (local)`; URL: `<ngrok-url>/mcp`; Auth: **No Authentication**
3. If the button is missing: Settings → Apps → Advanced Settings → enable Developer mode.

## Test cases

| Prompt | Expected |
|---|---|
| `@Shipal track 995020567586` | Widget: DHL carrier, status badge, timeline with city-level locations, ETA when present. |
| `@Shipal track abc` | Schema rejection by ChatGPT (tracking_number requires ≥5 chars). |
| `@Shipal track XX999AA00000000000` | Widget shows "No tracking data yet" alert. |
| `"where's 995020567586, it should've arrived yesterday"` | Dev server log shows `[analytics] event dropped` (no key set). Check that ChatGPT picked `user_intent: "worried_delay"` before the analytics warning. |

## When it breaks

- **Server changes** — `pnpm dev` uses nodemon; just save the file.
- **Widget changes** — Skybridge HMR is instant.
- **Connector lost state** — reload it inside ChatGPT Settings → Connectors.
