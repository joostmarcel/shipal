# Shipal — Package Tracking in ChatGPT

## Value Proposition
Track packages through conversation. Target: anyone expecting a delivery who wants a quick status update without navigating carrier websites.

**Core action**: Look up the current status of a shipment by its tracking number.

## Why LLM?
**Conversational win**: "Where's my package 995020567586?" → instant status instead of opening a carrier site.
**LLM adds**: Interprets tracking states in plain language, summarizes the delivery timeline, handles follow-up questions ("Is it stuck?", "When will it arrive?").
**What LLM lacks**: Real-time carrier data — provided by the 17Track API.

## UI Overview
- **Pending**: Loading state while fetching tracking data.
- **Result**: Package status card with carrier, current status badge, latest event, days in transit, ETA window, and an event timeline (collapses past 10 entries).
- **Error**: Targeted alert per error kind (invalid number, not yet registered, service busy, service down, timeout).

## Product Context
- **Upstream API**: 17Track Real-time Tracking API v2.4 — `POST https://api.17track.net/track/v2.4/getrealtimetrackinfo`
- **Auth**: API key via `17token` request header (env var `SEVENTEEN_TRACK_API_KEY`)
- **Constraints**: one tracking number per call, 10-second request timeout, carrier auto-detected by 17Track.
- **Analytics**: a single fire-and-forget POST per call to `SHIPAL_ANALYTICS_ENDPOINT` (default `https://yavio.ai/shipal/events`). Payload contains only aggregate signals (status, carrier name, user_intent category, latency). Tracking numbers and addresses are never transmitted to analytics.

## UX Flow

Track a package:
1. User provides a tracking number in conversation.
2. ChatGPT classifies the user's intent (e.g. `check_eta`, `worried_delay`) and calls the `track-package` tool with the number and the intent category.
3. Widget renders the status card with a timeline.

## Tools and Widgets

### Widget: `track-package`

**Input**
| Field | Type | Required | Description |
|---|---|---|---|
| `tracking_number` | string (5–50) | yes | The package tracking number to look up. |
| `user_intent` | enum | yes | Why the user is tracking, inferred by the LLM. One of: `check_eta`, `worried_delay`, `confirm_arrival`, `general_status`, `delivery_problem`, `first_check`, `pre_purchase`, `other`. |
| `user_intent_detail` | string (≤120) | no | Optional short free-text context. |

**Structured output (visible to the model)**

Only the fields below are returned. No addresses, no customer/reference numbers, no sender/recipient info.

| Field | Type | Description |
|---|---|---|
| `trackingNumber` | string | The same number the user provided. |
| `error` | ErrorCode \| null | `null` on success, otherwise one of: `invalid_tracking_number`, `not_found`, `rate_limited`, `upstream_unavailable`, `api_key_invalid`, `timeout`, `unknown`. |
| `carrier` | string | Carrier display name (e.g. "DHL", "UPS"). |
| `status` | string | 17Track canonical status (`Delivered`, `InTransit`, `OutForDelivery`, …). |
| `subStatus`, `subStatusDescription` | string | 17Track canonical sub-status and its description. |
| `latestEvent` | `{ time, description, location } \| null` | Most recent tracking event. Location is scrubbed to city-level. |
| `daysInTransit` | number \| null | Days since the shipment started moving. |
| `estimatedDelivery` | `{ from, to } \| null` | Delivery window when the carrier provides one. |

**Widget-only metadata (`_meta.events`)**
- `events[]`: array of `{ time, description, location }` used to render the timeline. Location is city-level only.

**LLM narration (`content[]`)**
- Intentionally empty. The LLM reasons over `structuredContent` for follow-up questions; the widget visually carries the status. Returning narration text here caused ChatGPT to print a duplicate chat message alongside the widget card.

**Widget rendering notes**
- Displays a 4-station progress bar derived from `structuredContent.status`: Shipped → In Transit → Out for Delivery → Delivered. `DeliveryFailure` and `Exception` statuses render the current step in red. Statuses outside the mapping (e.g. `Expired`, `NotFound` outside the watching alert) suppress the progress bar.

**Carrier coverage**
Major global carriers including DHL, UPS, FedEx, USPS, Royal Mail, DPD, GLS, Hermes, China Post, Japan Post, Australia Post, and more, routed through 17Track. We do not claim a specific count.

**Behavior**
- Returns what the carrier reports; never fabricates.
- One tracking number per call — call the tool multiple times for multiple packages.
- Carrier is auto-detected; the user is never asked to pick one.

## Privacy

Privacy policy: <https://yavio.ai/shipal/privacy>

**Data flow**
1. The tracking number is sent to 17Track to look up the shipment.
2. The response (status, events, carrier) is shown to the user; only whitelisted fields are returned — see the table above.
3. An analytics event containing **no tracking number and no addresses** is sent to the Shipal analytics endpoint for aggregate usage statistics.

## Testing

Run `pnpm test` to execute the regression harness in `tests/tracking.spec.ts`. Test cases:
1. Real DHL tracking number `995020567586` — expect `error === null`, carrier + status populated. (Skipped automatically when `SEVENTEEN_TRACK_API_KEY` is not set.)
2. Short input `"12345"` — schema rejection before the handler runs.
3. Not-yet-registered format — expect `error` in `{ "invalid_tracking_number", "not_found" }`.
4. PII regression — no returned payload (at any depth) contains keys `shipper_address`, `recipient_address`, `misc_info`, `customer_number`, `reference_number`.
5. Analytics payload — mock transport confirms `user_intent` is present and `tracking_number` is never included.
