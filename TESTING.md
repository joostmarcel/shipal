# Testing Shipal in ChatGPT and Claude

End-to-end smoke tests against real 17Track data via an ngrok tunnel. The MCP server is the same on both sides — ChatGPT and Claude.ai both speak Streamable HTTP, no-auth, against `<ngrok-url>/mcp`.

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
   Leave `YAVIO_API_KEY` blank — analytics becomes a no-op, which is fine for testing.

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
curl -I $NGROK/privacy                                # 200
```

## Connect ChatGPT

1. [Apps Settings](https://chatgpt.com/apps#settings/Connectors) → **Create App**
2. Name: `Shipal (local)`; URL: `<ngrok-url>/mcp`; Auth: **No Authentication**
3. If the button is missing: Settings → Apps → Advanced Settings → enable Developer mode.

## Connect Claude.ai / Claude Desktop

1. [Settings → Connectors](https://claude.ai/settings/connectors) → **Add custom connector**
2. Name: `Shipal (local)`; URL: `<ngrok-url>/mcp`; Auth: **None**.
3. The same connector entry shows up in Claude Desktop once you restart the desktop app.

## Connect Claude Code

```
claude mcp add shipal-local --transport http --url <ngrok-url>/mcp
```

Then in any `claude` session, ask a tracking question; the tool will appear under the `mcp__shipal-local__` namespace.

## Test cases

These are the canonical inputs. Run each one on **every surface listed in the matrix below**.

| # | Prompt | Expected on success |
|---|---|---|
| 1 | `@Shipal track 995020567586` | Widget renders with carrier=DHL Paket, an active progress bar, the latest event with a city-level location (street stripped), and an event timeline. `daysInTransit` and ETA appear when 17Track returns them. |
| 2 | `@Shipal track abc` | The MCP host (ChatGPT / Claude) rejects the call against the input schema (`tracking_number` requires ≥5 chars). The handler is never invoked. |
| 3 | `@Shipal track XX999AA00000000000` | `XX999AA00000000000` passes the length check but 17Track classifies it as a rejected entry. The widget renders the `invalid_tracking_number` alert: title **"Not a tracking number"**, body `"XX999AA00000000000" is not a recognized tracking number format.` |
| 4 | `"where's 995020567586, it should've arrived yesterday"` | Same widget render as #1. Dev-server log shows `[analytics] YAVIO_API_KEY not set — analytics disabled` (or, once `YAVIO_API_KEY` is set, events are batched to Yavio). The LLM has classified `user_intent: "worried_delay"` — confirm by checking the dev-server transcript or the analytics dashboard once production is wired up. |

If you're testing the production deployment instead of local, swap `<ngrok-url>` for `https://shipal-18736126069.europe-west1.run.app/mcp` and skip the ngrok step.

## Surface matrix

OpenAI and Anthropic both require parity across their listed surfaces. Tick each cell after running the four test cases above.

| Surface | Test 1 | Test 2 | Test 3 | Test 4 |
|---|---|---|---|---|
| ChatGPT web | ☐ | ☐ | ☐ | ☐ |
| ChatGPT mobile | ☐ | ☐ | ☐ | ☐ |
| Claude.ai web | ☐ | ☐ | ☐ | ☐ |
| Claude Desktop | ☐ | ☐ | ☐ | ☐ |
| Claude Code | ☐ | ☐ | ☐ | ☐ |

For each "✓ on Test 1" cell on Claude.ai web and Claude Desktop, also save a screenshot to `docs/submission-screenshots/` per the format in §"Pre-submission checklist".

## Pre-submission checklist

### OpenAI App Store

- [ ] All four test cases pass on ChatGPT web AND ChatGPT mobile.
- [ ] Screenshots saved as `chatgpt-web-{1,3,4}.png` and `chatgpt-mobile-{1,3,4}.png` (PNG, ≥1000px wide, **cropped to the widget response only — no prompt visible**).
- [ ] Production `https://shipal-18736126069.europe-west1.run.app/health` returns `{"ok":true}`.
- [ ] Production `https://shipal-18736126069.europe-west1.run.app/privacy` returns 200 + the policy HTML.
- [ ] App description in the OpenAI Platform dashboard matches the tool description in `server/src/server.ts` and SPEC.md verbatim.
- [ ] Privacy policy URL in the dashboard set to the production `/privacy` URL.
- [ ] Test cases pasted into the dashboard match the rows above (cross-surface column included).

### Anthropic Custom Connector directory (Remote MCP)

- [ ] All four test cases pass on Claude.ai web AND Claude Desktop AND Claude Code.
- [ ] Screenshots saved as `claude-web-{1,3,4}.png` and `claude-desktop-{1,3,4}.png` (PNG, ≥1000px wide, **cropped to the widget response only**).
- [ ] Production health + privacy URLs return 200 (same as OpenAI checklist).
- [ ] Tool annotations: `title: "Track a package"`, `readOnlyHint: true`. Verify in `server/src/server.ts:330–335`.
- [ ] README has a Privacy section with a working link to the production `/privacy` URL.
- [ ] Submission form: server name, URL, tagline, description, use cases, transport=streamable HTTP, auth=none, R/W=read-only, tested surfaces filled in.
- [ ] Test account / setup instructions: provide the public DHL number `995020567586` as the canonical happy-path test value, plus `XX999AA00000000000` for the error path.

## When it breaks

- **Server changes** — `pnpm dev` uses nodemon; just save the file.
- **Widget changes** — Skybridge HMR is instant.
- **Connector lost state** — reload it inside ChatGPT / Claude.ai Connectors settings.
- **MCP protocol issues** — run `npx @modelcontextprotocol/inspector <ngrok-url>/mcp` to validate the server before bringing up a Claude / ChatGPT session.
