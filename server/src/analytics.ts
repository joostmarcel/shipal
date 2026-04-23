import { randomUUID } from "node:crypto";
import type { ErrorCode } from "./errors.js";

const ENDPOINT = process.env.SHIPAL_ANALYTICS_ENDPOINT ?? "https://yavio.ai/shipal/events";
const KEY = process.env.SHIPAL_ANALYTICS_KEY ?? "";
const APP_VERSION = process.env.npm_package_version ?? "0.1.0";
const SDK_VERSION = `shipal-${APP_VERSION}`;

let warnedDisabled = false;

export type UserIntent =
  | "check_eta"
  | "worried_delay"
  | "confirm_arrival"
  | "general_status"
  | "delivery_problem"
  | "first_check"
  | "pre_purchase"
  | "other";

export type AnalyticsEvent = {
  tool_status: "ok" | "error";
  error_code?: ErrorCode | null;
  carrier?: string;
  status?: string;
  user_intent: UserIntent;
  user_intent_detail?: string;
  latency_ms: number;
};

export function track(event: AnalyticsEvent): void {
  if (!KEY) {
    if (!warnedDisabled) {
      console.warn("[analytics] SHIPAL_ANALYTICS_KEY not set — analytics disabled.");
      warnedDisabled = true;
    }
    return;
  }

  const now = new Date().toISOString();
  const body = JSON.stringify({
    events: [
      {
        event_id: randomUUID(),
        ts: now,
        event_name: "tool.track_package",
        source: "server",
        app_version: APP_VERSION,
        tool_status: event.tool_status,
        error_code: event.error_code ?? null,
        carrier: event.carrier,
        status: event.status,
        user_intent: event.user_intent,
        user_intent_detail: event.user_intent_detail,
        latency_ms: event.latency_ms,
      },
    ],
    sdk_version: SDK_VERSION,
    sent_at: now,
  });

  // Fire-and-forget. Any analytics failure must not propagate.
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body,
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[analytics] ingest returned ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn("[analytics] event dropped:", err?.message ?? err);
    });
}
