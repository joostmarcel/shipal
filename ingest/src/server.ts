import Fastify from "fastify";
import { BigQuery } from "@google-cloud/bigquery";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const BEARER = process.env.SHIPAL_INGEST_KEY ?? "";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "";
const DATASET = process.env.BQ_DATASET ?? "shipal_analytics";
const TABLE = process.env.BQ_TABLE ?? "events";
const PORT = parseInt(process.env.PORT ?? "8080", 10);

if (!BEARER) throw new Error("SHIPAL_INGEST_KEY is required");
if (!PROJECT_ID) throw new Error("GOOGLE_CLOUD_PROJECT is required");

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

// All signal fields accept null — Yavio SDK and our own analytics.ts emit
// `null` rather than omitting keys for fields that are optional-at-runtime
// (e.g. error_code is null on success). Zod .optional() alone only accepts
// undefined, so .nullable().optional() is the correct combination here.
const EVENT = z
  .object({
    event_id: z.string().nullable().optional(),
    ts: z.string().datetime().nullable().optional(),
    event_name: z.string().min(1).max(100),
    source: z.enum(["server", "widget"]).default("server"),
    app_version: z.string().max(50).nullable().optional(),
    tool_status: z.enum(["ok", "error"]).nullable().optional(),
    error_code: z.string().max(50).nullable().optional(),
    carrier: z.string().max(100).nullable().optional(),
    status: z.string().max(50).nullable().optional(),
    user_intent: z.string().max(50).nullable().optional(),
    user_intent_detail: z.string().max(120).nullable().optional(),
    latency_ms: z.number().int().nonnegative().max(600000).nullable().optional(),
  })
  .passthrough();

type Event = z.infer<typeof EVENT>;

const BATCH = z.object({
  events: z.array(EVENT).min(1).max(500),
  sdk_version: z.string().max(50).optional(),
  sent_at: z.string().datetime().optional(),
});

const bq = new BigQuery({ projectId: PROJECT_ID });
const table = bq.dataset(DATASET).table(TABLE);

function rowFromEvent(e: Event): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    event_id: e.event_id ?? randomUUID(),
    ts: e.ts ?? now,
    ingested_at: now,
    event_name: e.event_name,
    source: e.source ?? "server",
    app_version: e.app_version ?? null,
    tool_status: e.tool_status ?? null,
    error_code: e.error_code ?? null,
    carrier: e.carrier ?? null,
    status: e.status ?? null,
    user_intent: e.user_intent ?? null,
    user_intent_detail: e.user_intent_detail ?? null,
    latency_ms: e.latency_ms ?? null,
    raw_event: JSON.stringify(e),
  };
}

const app = Fastify({ logger: { level: "info" } });

app.get("/health", async () => ({ ok: true }));

app.post("/v1/events", async (request, reply) => {
  const auth = request.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_bearer" });
  }
  if (auth.slice(7) !== BEARER) {
    return reply.code(401).send({ error: "invalid_bearer" });
  }

  // Accept either a batch `{ events: [...] }` or a single event `{ event_name, ... }`.
  const raw = request.body as unknown;
  let events: Event[];
  const batchParse = BATCH.safeParse(raw);
  if (batchParse.success) {
    events = batchParse.data.events;
  } else {
    const singleParse = EVENT.safeParse(raw);
    if (!singleParse.success) {
      return reply.code(400).send({
        error: "validation_failed",
        detail: singleParse.error.issues.slice(0, 5),
      });
    }
    events = [singleParse.data];
  }

  // Hard PII guard: refuse to accept anything carrying tracking numbers
  // or addresses, even if the shipal server would never emit them.
  const offending = events.findIndex(containsForbiddenKey);
  if (offending !== -1) {
    return reply.code(422).send({
      error: "forbidden_field",
      detail: "event contained a reserved PII key",
      index: offending,
    });
  }

  const rows = events.map(rowFromEvent);
  try {
    await table.insert(rows, { skipInvalidRows: false, ignoreUnknownValues: true });
  } catch (err) {
    request.log.error({ err }, "bigquery insert failed");
    return reply.code(502).send({ error: "bigquery_insert_failed" });
  }

  return reply.code(200).send({
    accepted: rows.length,
    rejected: 0,
    request_id: randomUUID(),
  });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`shipal-ingest listening on :${PORT}, dataset=${DATASET}.${TABLE}`);
});
