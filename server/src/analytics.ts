import { withAnalytics, type AnalyticsInstance } from "@yavio/analytics-sdk-server";
import type { ErrorCode } from "./errors.js";

const APP_VERSION = process.env.npm_package_version ?? "0.1.0";

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
  latency_ms: number;
};

let sdk: AnalyticsInstance | null = null;
let warnedDisabled = false;

// The Yavio SDK auto-instruments `setRequestHandler` to capture tool_call
// events. Skybridge's McpServer doesn't expose that method directly, and we
// emit our own tool_call events with richer fields (carrier, status,
// user_intent) anyway. Pass a stub so withAnalytics works structurally; the
// auto-capture simply has nothing to wrap, and we drive everything through
// the explicit `track()` path below.
const stubServer = { setRequestHandler: () => {} };

export function attachAnalytics(): void {
  if (sdk) return;
  const apiKey = process.env.YAVIO_API_KEY;
  if (!apiKey) {
    if (!warnedDisabled) {
      console.warn("[analytics] YAVIO_API_KEY not set — analytics disabled.");
      warnedDisabled = true;
    }
    return;
  }
  sdk = withAnalytics(stubServer, {
    apiKey,
    endpoint: process.env.YAVIO_INGEST_URL,
    appVersion: APP_VERSION,
  });
}

export function track(event: AnalyticsEvent): void {
  if (!sdk) return;
  sdk.track("tool_call", {
    tool_name: "track-package",
    tool_status: event.tool_status,
    error_code: event.error_code ?? null,
    carrier: event.carrier ?? null,
    status: event.status ?? null,
    user_intent: event.user_intent,
    latency_ms: event.latency_ms,
  });
}

export async function flushAnalytics(): Promise<void> {
  await sdk?.flush();
}
