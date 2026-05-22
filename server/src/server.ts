import { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  classify17TrackError,
  type ErrorCode,
  type UpstreamResponse,
} from "./errors.js";
import { resolveCarrier } from "./carriers.js";
import { isRetriableHttp, withRetry } from "./retry.js";
import { track, type UserIntent } from "./analytics.js";

const SEVENTEEN_TRACK_API_KEY = process.env.SEVENTEEN_TRACK_API_KEY ?? "";
const USER_AGENT = "shipal/0.1.0";

type TrackingEventRaw = {
  time_iso: string;
  time_utc: string;
  description: string;
  location: string;
  stage: string;
};

type TrackingProvider = {
  provider: { name: string };
  events: TrackingEventRaw[];
};

type TrackInfoResponse = UpstreamResponse & {
  code: number;
  data: {
    accepted: Array<{
      number: string;
      track_info: {
        latest_status: {
          status: string;
        };
        latest_event: TrackingEventRaw;
        time_metrics: {
          days_of_transit: number;
          estimated_delivery_date: { from: string; to: string };
        };
        tracking: { providers: TrackingProvider[] };
      };
    }>;
    rejected: Array<{
      number: string;
      error: { code: number; message: string };
    }>;
  };
};

type TrackingEvent = { time: string; description: string; location: string };

type StructuredOutput = {
  trackingNumber: string;
  error: ErrorCode | null;
  carrier: string;
  status: string;
  latestEvent: TrackingEvent | null;
  daysInTransit: number | null;
  estimatedDelivery: { from: string; to: string } | null;
};

export function scrubLocation(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const looksLikeStreet = (part: string) =>
    /\d/.test(part) && /[A-Za-z]/.test(part) && part.length > 4;
  const cleaned = parts.filter((p) => !looksLikeStreet(p));
  return cleaned.join(", ");
}

export function emptyResult(trackingNumber: string, error: ErrorCode): StructuredOutput {
  return {
    trackingNumber,
    error,
    carrier: "",
    status: "",
    latestEvent: null,
    daysInTransit: null,
    estimatedDelivery: null,
  };
}

export type FetchTrackingResult = { body: TrackInfoResponse; httpStatus: number };

const TRACK_API_BASE = "https://api.17track.net/track/v2.2";
const REGISTER_ERROR_CODE = -18019902; // "does not register, please register first"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A single 17Track item. `carrier` (the numeric 17Track carrier code) is only set
// when the user named a carrier; otherwise 17Track auto-detects it from the number.
type TrackItem = { number: string; carrier?: number };

async function post17Track(
  path: string,
  body: unknown,
): Promise<{ body: TrackInfoResponse; httpStatus: number }> {
  // Retry transient failures (429 / 5xx / timeout / network) with jittered backoff.
  // Per-attempt timeout is 7s so the worst case stays acceptable for a chat UI.
  return withRetry(
    async () => {
      const res = await fetch(`${TRACK_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "17token": SEVENTEEN_TRACK_API_KEY,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(7_000),
      });
      const parsed = (await res.json().catch(() => ({}))) as TrackInfoResponse;
      return { body: parsed, httpStatus: res.status };
    },
    {
      maxRetries: 2,
      baseDelayMs: 400,
      isRetriable: (r) => isRetriableHttp(r.httpStatus),
      // TimeoutError = AbortSignal.timeout; TypeError = fetch network failure.
      isRetriableError: (e) => e.name === "TimeoutError" || e.name === "TypeError",
    },
  );
}

// A freshly registered number often has no scan data on the immediate read; treat
// "no accepted entries" or "still unregistered" as worth one short re-poll.
function isEmptyTrackResult(result: FetchTrackingResult): boolean {
  const accepted = result.body?.data?.accepted ?? [];
  const stillUnregistered =
    result.body?.data?.rejected?.[0]?.error?.code === REGISTER_ERROR_CODE;
  return accepted.length === 0 || stillUnregistered;
}

async function defaultFetchTracking(
  trackingNumber: string,
  carrier: number | null,
): Promise<FetchTrackingResult> {
  const item: TrackItem =
    carrier == null ? { number: trackingNumber } : { number: trackingNumber, carrier };

  let result = await _internal.post("/gettrackinfo", [item]);

  // If the number hasn't been registered yet, register and retry.
  const rejection = result.body?.data?.rejected?.[0]?.error?.code;
  if (rejection === REGISTER_ERROR_CODE) {
    const reg = await _internal.post("/register", [item]);
    if (reg.httpStatus === 200 && (reg.body?.code ?? -1) === 0) {
      result = await _internal.post("/gettrackinfo", [item]);
      // 17Track may take a few seconds to populate the first scan after register.
      // Re-poll once before giving up so just-shipped numbers return data.
      if (isEmptyTrackResult(result)) {
        await sleep(_internal.repollDelayMs);
        result = await _internal.post("/gettrackinfo", [item]);
      }
    } else {
      console.warn(
        "[shipal] 17Track /register failed:",
        reg.httpStatus,
        JSON.stringify(reg.body).slice(0, 200),
      );
    }
  }

  if (result.httpStatus !== 200 || (result.body?.code ?? 0) !== 0) {
    console.warn(
      "[shipal] 17Track upstream non-OK:",
      result.httpStatus,
      JSON.stringify(result.body).slice(0, 300),
    );
  }

  return result;
}

// Indirection so tests can stub the upstream call without hitting 17Track.
// `post` is the network seam used by defaultFetchTracking; `fetchTracking` is the
// higher-level seam used by handler tests. `repollDelayMs` is overridable so tests
// don't actually wait.
export const _internal = {
  fetchTracking: defaultFetchTracking as (
    tn: string,
    carrier: number | null,
  ) => Promise<FetchTrackingResult>,
  post: post17Track as (
    path: string,
    body: unknown,
  ) => Promise<FetchTrackingResult>,
  repollDelayMs: 1500,
};

export { defaultFetchTracking };

export type HandlerInput = {
  tracking_number: string;
  user_intent: UserIntent;
  carrier?: string;
};

export type HandlerResult = {
  structuredContent: StructuredOutput;
  content: Array<{ type: "text"; text: string }>;
  _meta: { events: TrackingEvent[] };
};

export async function handleTrackPackage(input: HandlerInput): Promise<HandlerResult> {
  const { tracking_number: trackingNumber, user_intent: userIntent } = input;
  const startedAt = Date.now();

  const emit = (status: "ok" | "error", result: StructuredOutput) => {
    track({
      tool_status: status,
      error_code: result.error,
      carrier: result.carrier || undefined,
      status: result.status || undefined,
      user_intent: userIntent,
      latency_ms: Date.now() - startedAt,
    });
  };

  const carrierCode = resolveCarrier(input.carrier);

  let fetched: FetchTrackingResult;
  try {
    fetched = await _internal.fetchTracking(trackingNumber, carrierCode);
  } catch (err) {
    const code: ErrorCode =
      err instanceof Error && err.name === "TimeoutError"
        ? "timeout"
        : "upstream_unavailable";
    const structuredContent = emptyResult(trackingNumber, code);
    emit("error", structuredContent);
    return {
      structuredContent,
      content: [],
      _meta: { events: [] as TrackingEvent[] },
    };
  }

  const { body, httpStatus } = fetched;

  if (
    httpStatus !== 200 ||
    (body.code !== undefined && body.code !== 0) ||
    (body.data?.rejected?.length ?? 0) > 0
  ) {
    const code = classify17TrackError(body, httpStatus);
    const structuredContent = emptyResult(trackingNumber, code);
    emit("error", structuredContent);
    return {
      structuredContent,
      content: [],
      _meta: { events: [] as TrackingEvent[] },
    };
  }

  const accepted = body.data.accepted;
  if (!accepted || accepted.length === 0) {
    const structuredContent = emptyResult(trackingNumber, "not_found");
    emit("error", structuredContent);
    return {
      structuredContent,
      content: [],
      _meta: { events: [] as TrackingEvent[] },
    };
  }

  const info = accepted[0].track_info;

  const allEvents: TrackingEvent[] = [];
  for (const provider of info.tracking?.providers ?? []) {
    for (const ev of provider.events ?? []) {
      if (!ev) continue;
      allEvents.push({
        time: ev.time_iso ?? "",
        description: ev.description ?? "",
        location: scrubLocation(ev.location ?? ""),
      });
    }
  }
  allEvents.sort((a, b) => {
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  const carrierName = info.tracking?.providers?.[0]?.provider?.name ?? "Unknown";

  const latestRaw = info.latest_event;
  const latestEvent: TrackingEvent | null = latestRaw
    ? {
        time: latestRaw.time_iso ?? "",
        description: latestRaw.description ?? "",
        location: scrubLocation(latestRaw.location ?? ""),
      }
    : null;

  const eta = info.time_metrics?.estimated_delivery_date;
  const structuredContent: StructuredOutput = {
    trackingNumber,
    error: null,
    carrier: carrierName,
    status: info.latest_status?.status ?? "Unknown",
    latestEvent,
    daysInTransit: info.time_metrics?.days_of_transit ?? null,
    estimatedDelivery:
      eta && (eta.from || eta.to) ? { from: eta.from, to: eta.to } : null,
  };

  emit("ok", structuredContent);

  return {
    structuredContent,
    content: [],
    _meta: { events: allEvents },
  };
}

export const server = new McpServer(
  {
    name: "shipal",
    version: "0.1.0",
    icons: [{ src: "/assets/icon.svg", mimeType: "image/svg+xml" }],
  },
  { capabilities: {} },
).registerWidget(
  "track-package",
  {
    description: "Look up the current status and event history of a parcel by tracking number.",
    _meta: {
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: ["https://cdn.openai.com"],
        },
      },
    },
  },
  {
    description:
      "Look up the current status of a parcel by its tracking number via the 17Track service. The tool returns: the carrier name (auto-detected from the number — never ask the user), the canonical shipment status (Delivered, InTransit, OutForDelivery, etc.), the most recent tracking event (description, scrubbed-to-city location, timestamp), days in transit, and the carrier's estimated delivery window when one is available. The widget additionally renders a chronological event history. On error the response carries a typed `error` code (`invalid_tracking_number`, `not_found`, `carrier_not_detected`, `rate_limited`, `upstream_unavailable`, `api_key_invalid`, `timeout`, `unknown`) and the widget displays a targeted alert. If `error` is `carrier_not_detected`, the number's carrier could not be auto-detected — ask the user which carrier shipped it and call again with that name in `carrier`. Take one tracking number per call. Do not invent or assume tracking data beyond what the response contains. Do not narrate or summarize the rendered widget; speak again only if the user asks a follow-up (e.g. 'is it delivered?', 'when will it arrive?').",
    inputSchema: {
      tracking_number: z
        .string()
        .min(5)
        .max(50)
        .describe(
          'The package tracking number to look up, e.g. "1Z999AA10123456784" or "JD014600004033839702".',
        ),
      carrier: z
        .string()
        .max(60)
        .optional()
        .describe(
          'OPTIONAL carrier name. Normally leave this UNSET — 17Track auto-detects the carrier from the number. Only set it when the user names or clearly implies a carrier (e.g. "my UPS package", "the DHL parcel"), or when a previous lookup returned error "carrier_not_detected" and the user has since told you the carrier. Use a plain name like "UPS", "DHL", "USPS", "Royal Mail", "FedEx", "DPD".',
        ),
      user_intent: z
        .enum([
          "check_eta",
          "worried_delay",
          "confirm_arrival",
          "general_status",
          "delivery_problem",
          "first_check",
          "pre_purchase",
          "other",
        ])
        .describe(
          "Categorical bucket (fixed enum, not free text) describing why the user is tracking this package, inferred from the conversation. Used only for anonymous aggregate analytics — never returned to the user, never combined with the tracking number, and never stored alongside any identifier. Pick the single best match: check_eta (wants arrival date), worried_delay (package seems late), confirm_arrival (verifying delivery happened), general_status (no specific concern), delivery_problem (reporting an issue), first_check (first time looking), pre_purchase (evaluating a seller), other.",
        ),
    },
    annotations: {
      title: "Track a package",
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async (input) => handleTrackPackage(input as HandlerInput),
);

export type AppType = typeof server;
