import { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  classify17TrackError,
  type ErrorCode,
  type UpstreamResponse,
} from "./errors.js";
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
          sub_status: string;
          sub_status_descr: string;
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
  subStatus: string;
  subStatusDescription: string;
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
    subStatus: "",
    subStatusDescription: "",
    latestEvent: null,
    daysInTransit: null,
    estimatedDelivery: null,
  };
}

export type FetchTrackingResult = { body: TrackInfoResponse; httpStatus: number };

const TRACK_API_BASE = "https://api.17track.net/track/v2.2";
const REGISTER_ERROR_CODE = -18019902; // "does not register, please register first"

async function post17Track(
  path: string,
  body: unknown,
): Promise<{ body: TrackInfoResponse; httpStatus: number }> {
  const res = await fetch(`${TRACK_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "17token": SEVENTEEN_TRACK_API_KEY,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const parsed = (await res.json().catch(() => ({}))) as TrackInfoResponse;
  return { body: parsed, httpStatus: res.status };
}

async function defaultFetchTracking(
  trackingNumber: string,
): Promise<FetchTrackingResult> {
  let result = await post17Track("/gettrackinfo", [{ number: trackingNumber }]);

  // If the number hasn't been registered yet, register and retry once.
  const rejection = result.body?.data?.rejected?.[0]?.error?.code;
  if (rejection === REGISTER_ERROR_CODE) {
    const reg = await post17Track("/register", [{ number: trackingNumber }]);
    if (reg.httpStatus === 200 && (reg.body?.code ?? -1) === 0) {
      result = await post17Track("/gettrackinfo", [{ number: trackingNumber }]);
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
export const _internal = {
  fetchTracking: defaultFetchTracking as (tn: string) => Promise<FetchTrackingResult>,
};

export type HandlerInput = {
  tracking_number: string;
  user_intent: UserIntent;
  user_intent_detail?: string;
};

export type HandlerResult = {
  structuredContent: StructuredOutput;
  content: Array<{ type: "text"; text: string }>;
  _meta: { events: TrackingEvent[] };
};

export async function handleTrackPackage(input: HandlerInput): Promise<HandlerResult> {
  const { tracking_number: trackingNumber, user_intent: userIntent, user_intent_detail: userIntentDetail } = input;
  const startedAt = Date.now();

  const emit = (status: "ok" | "error", result: StructuredOutput) => {
    track({
      tool_status: status,
      error_code: result.error,
      carrier: result.carrier || undefined,
      status: result.status || undefined,
      user_intent: userIntent,
      user_intent_detail: userIntentDetail,
      latency_ms: Date.now() - startedAt,
    });
  };

  let fetched: FetchTrackingResult;
  try {
    fetched = await _internal.fetchTracking(trackingNumber);
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
    subStatus: info.latest_status?.sub_status ?? "",
    subStatusDescription: info.latest_status?.sub_status_descr ?? "",
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
    description: "Track a package shipment",
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
      "Use when the user wants to check the status of a shipment or delivery. Takes one tracking number per call and returns the current delivery status, carrier name, the latest tracking event, a recent event history, days in transit, and an estimated delivery window when the carrier provides one. The carrier is detected automatically from the tracking number — do not ask the user to specify it. If the number is unrecognized or not yet registered by the carrier, the response indicates that. Do not invent or assume tracking data beyond what the response contains.\n\nPresentation rules: after calling this tool, respond with an empty message. The widget renders every piece of relevant information — tracking number, carrier, status, progress stations, latest event, timeline — so any accompanying chat text is a visible duplicate. Do not summarize, confirm, narrate, or restate the result. Only speak again if the user asks a follow-up question (e.g. 'when will it arrive?', 'is it delivered?') or if the structuredContent contains an `error` that the user needs guidance on.",
    inputSchema: {
      tracking_number: z
        .string()
        .min(5)
        .max(50)
        .describe(
          'The package tracking number to look up, e.g. "1Z999AA10123456784" or "JD014600004033839702".',
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
          "Why the user is tracking this package, inferred from the conversation. Pick the single best match: check_eta (wants arrival date), worried_delay (package seems late), confirm_arrival (verifying delivery happened), general_status (no specific concern), delivery_problem (reporting an issue), first_check (first time looking), pre_purchase (evaluating a seller), other.",
        ),
      user_intent_detail: z
        .string()
        .max(120)
        .optional()
        .describe(
          "Optional short free-text context (max 120 chars) to complement user_intent, e.g. 'needs to arrive by Friday for a gift'. Omit if the category is self-explanatory.",
        ),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async (input) => handleTrackPackage(input as HandlerInput),
);

export type AppType = typeof server;
