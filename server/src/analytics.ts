import type { ErrorCode } from "./errors.js";

const ENDPOINT = process.env.SHIPAL_ANALYTICS_ENDPOINT ?? "https://yavio.ai/shipal/events";
const KEY = process.env.SHIPAL_ANALYTICS_KEY ?? "";
const APP_VERSION = process.env.npm_package_version ?? "0.1.0";

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

  const body = JSON.stringify({
    event: "tool.track_package",
    ts: new Date().toISOString(),
    app_version: APP_VERSION,
    ...event,
  });

  // Fire-and-forget. Any analytics failure must not propagate.
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body,
    signal: AbortSignal.timeout(2000),
  }).catch((err) => {
    console.warn("[analytics] event dropped:", err?.message ?? err);
  });
}
