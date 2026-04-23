import { test } from "node:test";
import assert from "node:assert/strict";

// Unit tests for the PII guard + schema. We don't spin up Fastify here
// because the full server boot touches BigQuery. Validating the parsing
// + guard functions directly is enough for the regression we care about.

import { z } from "zod";

// Re-declare the schemas here (mirror of server.ts) so the tests don't
// need to export them from the runtime file. Keep in sync.
const EVENT = z
  .object({
    event_id: z.string().optional(),
    ts: z.string().datetime().optional(),
    event_name: z.string().min(1).max(100),
    source: z.enum(["server", "widget"]).default("server"),
    app_version: z.string().max(50).optional(),
    tool_status: z.enum(["ok", "error"]).optional(),
    error_code: z.string().max(50).optional(),
    carrier: z.string().max(100).optional(),
    status: z.string().max(50).optional(),
    user_intent: z.string().max(50).optional(),
    user_intent_detail: z.string().max(120).optional(),
    latency_ms: z.number().int().nonnegative().max(600000).optional(),
  })
  .passthrough();

const BATCH = z.object({
  events: z.array(EVENT).min(1).max(500),
  sdk_version: z.string().max(50).optional(),
  sent_at: z.string().datetime().optional(),
});

const FORBIDDEN_PII_KEYS = new Set([
  "tracking_number",
  "shipper_address",
  "recipient_address",
  "misc_info",
  "customer_number",
  "reference_number",
  "local_number",
]);

function containsForbiddenKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_PII_KEYS.has(k)) return true;
    if (containsForbiddenKey((value as Record<string, unknown>)[k])) return true;
  }
  return false;
}

test("valid minimal event passes schema", () => {
  const r = EVENT.safeParse({ event_name: "tool.track_package" });
  assert.equal(r.success, true);
});

test("valid full event passes schema", () => {
  const r = EVENT.safeParse({
    event_id: "abc",
    ts: "2026-04-23T12:00:00Z",
    event_name: "tool.track_package",
    source: "server",
    app_version: "0.1.0",
    tool_status: "ok",
    error_code: undefined,
    carrier: "DHL Paket",
    status: "Delivered",
    user_intent: "check_eta",
    user_intent_detail: "gift for Friday",
    latency_ms: 842,
  });
  assert.equal(r.success, true);
});

test("missing event_name fails", () => {
  const r = EVENT.safeParse({ source: "server" });
  assert.equal(r.success, false);
});

test("invalid latency (negative) fails", () => {
  const r = EVENT.safeParse({ event_name: "x", latency_ms: -1 });
  assert.equal(r.success, false);
});

test("batch with 0 events fails", () => {
  const r = BATCH.safeParse({ events: [] });
  assert.equal(r.success, false);
});

test("batch with 1 event passes", () => {
  const r = BATCH.safeParse({ events: [{ event_name: "tool.track_package" }] });
  assert.equal(r.success, true);
});

test("PII guard catches tracking_number at top level", () => {
  assert.equal(
    containsForbiddenKey({ event_name: "x", tracking_number: "123" }),
    true,
  );
});

test("PII guard catches shipper_address nested", () => {
  assert.equal(
    containsForbiddenKey({
      event_name: "x",
      extra: { deep: { shipper_address: { city: "Berlin" } } },
    }),
    true,
  );
});

test("PII guard catches misc_info", () => {
  assert.equal(
    containsForbiddenKey({ event_name: "x", misc_info: { customer_number: "A" } }),
    true,
  );
});

test("PII guard returns false for clean event", () => {
  assert.equal(
    containsForbiddenKey({
      event_name: "tool.track_package",
      carrier: "DHL",
      user_intent: "check_eta",
      latency_ms: 100,
    }),
    false,
  );
});

test("user_intent_detail over 120 chars fails schema", () => {
  const r = EVENT.safeParse({
    event_name: "x",
    user_intent_detail: "a".repeat(121),
  });
  assert.equal(r.success, false);
});
