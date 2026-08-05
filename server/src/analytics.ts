import { McpServer } from "skybridge/server";
import { withYavio, yavio } from "@yavio/sdk";
import type { ErrorCode } from "./errors.js";

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
  /** Carrier-reported transit duration. A duration, never a date or a place. */
  days_in_transit?: number | null;
  /** Whether the carrier supplied a delivery estimate — not the estimate itself. */
  has_eta?: boolean;
  /** How many scan events the carrier published. A count, never their contents. */
  checkpoint_count?: number;
};

/**
 * Wrap a Skybridge `McpServer` with Yavio (`@yavio/sdk`) instrumentation.
 *
 * `withYavio` only auto-instruments the MCP SDK's 3-arg
 * `registerTool(name, config, cb)`; Skybridge's `McpServer` overrides
 * `registerTool` with a 2-arg `registerTool(config, cb)` form. We bridge the
 * two with a pair of proxies:
 *
 *   - the **inner** proxy is what `withYavio` calls as the "original": it takes
 *     the 3-arg form and forwards to Skybridge's 2-arg `registerTool`;
 *   - the **outer** proxy presents Skybridge's 2-arg signature to our code (so
 *     `AppType` inference is preserved) and re-invokes the `withYavio` proxy
 *     with the 3-arg form so the tool callback actually gets wrapped.
 *
 * Wrapping the callback is what establishes the `AsyncLocalStorage` trace
 * context that `yavio.track()` needs and emits the auto-captured `tool_call`
 * event.
 *
 * Privacy is enforced two ways, per Shipal's privacy policy (no tracking
 * numbers, addresses, or locations may reach analytics):
 *   - `capture.inputValues/outputValues/geo` are disabled, so the auto
 *     `tool_call` event carries only latency, status, and platform — never the
 *     tracking number or scrubbed locations. We emit the curated, anonymous
 *     fields ourselves via {@link track}.
 *   - `serverOnly: true` disables `_meta.yavio` injection and widget-token
 *     minting. The React widget renders the tracking number and city in the
 *     DOM, and the widget SDK's auto-capture would read that element text, so
 *     browser-side capture is intentionally not enabled.
 *
 * With no `YAVIO_API_KEY`, this is a transparent no-op (the server is returned
 * unchanged and `track()` does nothing).
 */
export function instrumentServer<T extends McpServer>(base: T): T {
  if (!process.env.YAVIO_API_KEY) {
    console.warn("[analytics] YAVIO_API_KEY not set — analytics disabled.");
    return base;
  }

  // Inner: accept (name, config, cb) from withYavio, call Skybridge's (config, cb).
  const inner = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (_name: string, config: unknown, cb: unknown) =>
          (target as unknown as { registerTool: (c: unknown, cb: unknown) => unknown })
            .registerTool(config, cb);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const instrumented = withYavio(inner as never, {
    apiKey: process.env.YAVIO_API_KEY,
    endpoint: process.env.YAVIO_ENDPOINT,
    serverOnly: true,
    capture: { inputValues: false, outputValues: false, geo: false },
  });

  // Outer: present Skybridge's (config, cb) signature, call withYavio's proxy
  // with (name, config, cb) so it instruments the handler.
  return new Proxy(instrumented as object, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (config: { name?: string }, cb: unknown) =>
          (target as unknown as { registerTool: (n: string, c: unknown, cb: unknown) => unknown })
            .registerTool(config?.name ?? "unknown", config, cb);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

/**
 * The exact set of fields that may leave this server for analytics.
 *
 * Every field is either a category (carrier, status, intent), a count, or a
 * duration. None identifies a parcel, a person or a place — deliberately, so
 * that auto-capture staying off (see {@link instrumentServer}) is not the only
 * thing standing between the tracking number and analytics.
 *
 * The key set is asserted in tests. Adding a field here is a privacy decision:
 * make it consciously, and keep it derivable rather than raw.
 */
export const TRACK_PAYLOAD_KEYS = [
  "tool_name",
  "tool_status",
  "error_code",
  "carrier",
  "status",
  "user_intent",
  "latency_ms",
  "days_in_transit",
  "has_eta",
  "checkpoint_count",
] as const;

/** Build the curated payload. Exported so tests can assert it without a transport. */
export function buildTrackPayload(event: AnalyticsEvent): Record<string, unknown> {
  return {
    tool_name: "track-package",
    tool_status: event.tool_status,
    error_code: event.error_code ?? null,
    carrier: event.carrier ?? null,
    status: event.status ?? null,
    user_intent: event.user_intent,
    latency_ms: event.latency_ms,
    days_in_transit: event.days_in_transit ?? null,
    has_eta: event.has_eta ?? false,
    checkpoint_count: event.checkpoint_count ?? 0,
  };
}

/**
 * Emit the curated, privacy-reviewed tool-call event. Runs inside the Yavio
 * trace context established by {@link instrumentServer} (the tool handler is
 * wrapped); outside that context it is a silent no-op.
 */
export function track(event: AnalyticsEvent): void {
  yavio.track("tool_call", buildTrackPayload(event));
}
