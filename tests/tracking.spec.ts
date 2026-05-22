import { test } from "node:test";
import assert from "node:assert/strict";

import {
  _internal,
  defaultFetchTracking,
  handleTrackPackage,
  scrubLocation,
  type FetchTrackingResult,
} from "../server/src/server.js";
import { classify17TrackError } from "../server/src/errors.js";
import { resolveCarrier } from "../server/src/carriers.js";
import { isRetriableHttp, withRetry } from "../server/src/retry.js";

const FORBIDDEN_PII_KEYS = [
  "shipper_address",
  "recipient_address",
  "misc_info",
  "customer_number",
  "reference_number",
  "local_number",
];

function findForbiddenKey(value: unknown, path: string[] = []): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PII_KEYS.includes(key)) return [...path, key].join(".");
    const hit = findForbiddenKey(v, [...path, key]);
    if (hit) return hit;
  }
  return null;
}

function mockFetch(result: FetchTrackingResult) {
  return async () => result;
}

// ---------------------------------------------------------------------------
// Unit — classifier
// ---------------------------------------------------------------------------

test("classify17TrackError: HTTP 429 → rate_limited", () => {
  assert.equal(classify17TrackError({}, 429), "rate_limited");
});

test("classify17TrackError: upstream code -18010 → api_key_invalid", () => {
  assert.equal(classify17TrackError({ code: -18010 }, 200), "api_key_invalid");
});

test("classify17TrackError: upstream code -18019 → rate_limited", () => {
  assert.equal(classify17TrackError({ code: -18019 }, 200), "rate_limited");
});

test("classify17TrackError: rejected entry → invalid_tracking_number", () => {
  const body = { code: 0, data: { rejected: [{ error: { code: -2 } }] } };
  assert.equal(classify17TrackError(body, 200), "invalid_tracking_number");
});

test("classify17TrackError: rejected -18019903 → carrier_not_detected", () => {
  const body = { code: 0, data: { rejected: [{ error: { code: -18019903 } }] } };
  assert.equal(classify17TrackError(body, 200), "carrier_not_detected");
});

// ---------------------------------------------------------------------------
// Unit — scrubLocation
// ---------------------------------------------------------------------------

test("scrubLocation: city/region/country passes through", () => {
  assert.equal(scrubLocation("Louisville, KY, US"), "Louisville, KY, US");
});

test("scrubLocation: strips street-token segments", () => {
  assert.equal(
    scrubLocation("123 Main St, Louisville, KY, US"),
    "Louisville, KY, US",
  );
});

test("scrubLocation: empty input", () => {
  assert.equal(scrubLocation(""), "");
});

// ---------------------------------------------------------------------------
// Handler — happy path with mocked upstream
// ---------------------------------------------------------------------------

const SAMPLE_OK: FetchTrackingResult = {
  httpStatus: 200,
  body: {
    code: 0,
    data: {
      accepted: [
        {
          number: "JD014600004033839702",
          track_info: {
            // Intentionally included in the upstream shape to prove we DON'T leak it:
            shipping_info: {
              shipper_address: {
                country: "DE",
                state: "BE",
                city: "Berlin",
                street: "Musterstrasse 1",
                postal_code: "10115",
              },
              recipient_address: {
                country: "US",
                state: "CA",
                city: "San Francisco",
                street: "123 Market St",
                postal_code: "94103",
              },
            },
            misc_info: {
              customer_number: "CUST-9931",
              reference_number: "PO-48821",
              local_number: "LOC-1",
            },
            latest_status: {
              status: "InTransit",
              sub_status: "InTransit_Other",
              sub_status_descr: "The shipment is in transit.",
            },
            latest_event: {
              time_iso: "2026-02-25T14:32:00Z",
              time_utc: "2026-02-25T14:32:00Z",
              description: "Departed facility",
              location: "123 Main St, Louisville, KY, US",
              stage: "Departure",
            },
            time_metrics: {
              days_of_transit: 3,
              estimated_delivery_date: {
                from: "2026-02-27T00:00:00Z",
                to: "2026-02-28T00:00:00Z",
              },
            },
            tracking: {
              providers: [
                {
                  provider: { name: "DHL" },
                  events: [
                    {
                      time_iso: "2026-02-25T14:32:00Z",
                      time_utc: "2026-02-25T14:32:00Z",
                      description: "Departed facility",
                      location: "123 Main St, Louisville, KY, US",
                      stage: "Departure",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      rejected: [],
    },
  } as any,
};

test("handleTrackPackage: happy path returns whitelisted output with scrubbed locations", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = mockFetch(SAMPLE_OK);
  try {
    const result = await handleTrackPackage({
      tracking_number: "JD014600004033839702",
      user_intent: "check_eta",
    });
    assert.equal(result.structuredContent.error, null);
    assert.equal(result.structuredContent.carrier, "DHL");
    assert.equal(result.structuredContent.status, "InTransit");
    assert.equal(result.structuredContent.daysInTransit, 3);
    assert.equal(
      result.structuredContent.latestEvent?.location,
      "Louisville, KY, US",
    );
  } finally {
    _internal.fetchTracking = prev;
  }
});

test("handleTrackPackage: output contains no PII keys at any depth", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = mockFetch(SAMPLE_OK);
  try {
    const result = await handleTrackPackage({
      tracking_number: "JD014600004033839702",
      user_intent: "check_eta",
    });
    const hit = findForbiddenKey(result);
    assert.equal(
      hit,
      null,
      hit ? `Found forbidden key in output at path: ${hit}` : undefined,
    );
  } finally {
    _internal.fetchTracking = prev;
  }
});

// ---------------------------------------------------------------------------
// Handler — error paths with mocked upstream
// ---------------------------------------------------------------------------

test("handleTrackPackage: 17Track rejection → invalid_tracking_number", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = mockFetch({
    httpStatus: 200,
    body: {
      code: 0,
      data: {
        accepted: [],
        rejected: [
          { number: "x", error: { code: -2, message: "Invalid number" } },
        ],
      },
    } as any,
  });
  try {
    const result = await handleTrackPackage({
      tracking_number: "0000000000",
      user_intent: "first_check",
    });
    assert.equal(result.structuredContent.error, "invalid_tracking_number");
    assert.equal(result.structuredContent.carrier, "");
    assert.deepEqual(result._meta.events, []);
  } finally {
    _internal.fetchTracking = prev;
  }
});

test("handleTrackPackage: HTTP 429 → rate_limited", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = mockFetch({ httpStatus: 429, body: {} as any });
  try {
    const result = await handleTrackPackage({
      tracking_number: "1Z999AA10123456784",
      user_intent: "check_eta",
    });
    assert.equal(result.structuredContent.error, "rate_limited");
  } finally {
    _internal.fetchTracking = prev;
  }
});

test("handleTrackPackage: upstream throws → upstream_unavailable", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = async () => {
    throw new Error("ECONNRESET");
  };
  try {
    const result = await handleTrackPackage({
      tracking_number: "1Z999AA10123456784",
      user_intent: "check_eta",
    });
    assert.equal(result.structuredContent.error, "upstream_unavailable");
  } finally {
    _internal.fetchTracking = prev;
  }
});

test("handleTrackPackage: TimeoutError → timeout", async () => {
  const prev = _internal.fetchTracking;
  _internal.fetchTracking = async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    throw err;
  };
  try {
    const result = await handleTrackPackage({
      tracking_number: "1Z999AA10123456784",
      user_intent: "check_eta",
    });
    assert.equal(result.structuredContent.error, "timeout");
  } finally {
    _internal.fetchTracking = prev;
  }
});

// ---------------------------------------------------------------------------
// Unit — resolveCarrier
// ---------------------------------------------------------------------------

test("resolveCarrier: exact alias", () => {
  assert.equal(resolveCarrier("UPS"), 100002);
  assert.equal(resolveCarrier("usps"), 21051);
});

test("resolveCarrier: normalizes case/whitespace/punctuation", () => {
  assert.equal(resolveCarrier("  United Parcel Service "), 100002);
  assert.equal(resolveCarrier("DHL Express"), 100001);
});

test("resolveCarrier: hermes/evri synonyms map to one code", () => {
  assert.equal(resolveCarrier("Hermes"), 100331);
  assert.equal(resolveCarrier("Evri"), 100331);
});

test("resolveCarrier: unknown / empty → null", () => {
  assert.equal(resolveCarrier("Pony Express"), null);
  assert.equal(resolveCarrier(""), null);
  assert.equal(resolveCarrier(undefined), null);
});

// ---------------------------------------------------------------------------
// Unit — withRetry
// ---------------------------------------------------------------------------

test("withRetry: retries on retriable result then succeeds", async () => {
  let calls = 0;
  const res = await withRetry(
    async () => {
      calls++;
      return { httpStatus: calls < 3 ? 429 : 200 };
    },
    { maxRetries: 2, baseDelayMs: 0, isRetriable: (r) => isRetriableHttp(r.httpStatus) },
  );
  assert.equal(res.httpStatus, 200);
  assert.equal(calls, 3);
});

test("withRetry: does not retry a non-retriable result", async () => {
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      return { httpStatus: 200 };
    },
    { maxRetries: 2, baseDelayMs: 0, isRetriable: (r) => isRetriableHttp(r.httpStatus) },
  );
  assert.equal(calls, 1);
});

test("withRetry: retries thrown TimeoutError then rethrows after budget", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        const e = new Error("timed out");
        e.name = "TimeoutError";
        throw e;
      },
      {
        maxRetries: 2,
        baseDelayMs: 0,
        isRetriable: () => false,
        isRetriableError: (e) => e.name === "TimeoutError",
      },
    ),
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("isRetriableHttp: 429 and 5xx only", () => {
  assert.equal(isRetriableHttp(429), true);
  assert.equal(isRetriableHttp(503), true);
  assert.equal(isRetriableHttp(200), false);
  assert.equal(isRetriableHttp(401), false);
});

// ---------------------------------------------------------------------------
// Handler — carrier hint threading
// ---------------------------------------------------------------------------

test("handleTrackPackage: forwards resolved carrier code to fetch", async () => {
  const prev = _internal.fetchTracking;
  let seenCarrier: number | null = -1;
  _internal.fetchTracking = async (_tn, carrier) => {
    seenCarrier = carrier;
    return SAMPLE_OK;
  };
  try {
    await handleTrackPackage({
      tracking_number: "JD014600004033839702",
      user_intent: "check_eta",
      carrier: "UPS",
    });
    assert.equal(seenCarrier, 100002);
  } finally {
    _internal.fetchTracking = prev;
  }
});

test("handleTrackPackage: unresolvable carrier → null (auto-detect)", async () => {
  const prev = _internal.fetchTracking;
  let seenCarrier: number | null = -1;
  _internal.fetchTracking = async (_tn, carrier) => {
    seenCarrier = carrier;
    return SAMPLE_OK;
  };
  try {
    await handleTrackPackage({
      tracking_number: "JD014600004033839702",
      user_intent: "check_eta",
      carrier: "Pony Express",
    });
    assert.equal(seenCarrier, null);
  } finally {
    _internal.fetchTracking = prev;
  }
});

// ---------------------------------------------------------------------------
// defaultFetchTracking — register + re-poll for delayed first scan
// ---------------------------------------------------------------------------

test("defaultFetchTracking: re-polls once after register when first result is empty", async () => {
  const prevPost = _internal.post;
  const prevDelay = _internal.repollDelayMs;
  _internal.repollDelayMs = 0; // no real wait in tests

  const REG_NEEDED: FetchTrackingResult = {
    httpStatus: 200,
    body: {
      code: 0,
      data: { accepted: [], rejected: [{ number: "x", error: { code: -18019902 } }] },
    } as any,
  };
  const REG_OK: FetchTrackingResult = { httpStatus: 200, body: { code: 0 } as any };
  const EMPTY_OK: FetchTrackingResult = {
    httpStatus: 200,
    body: { code: 0, data: { accepted: [], rejected: [] } } as any,
  };
  const sequence: FetchTrackingResult[] = [REG_NEEDED, REG_OK, EMPTY_OK, SAMPLE_OK];
  const paths: string[] = [];
  let i = 0;
  _internal.post = async (path) => {
    paths.push(path);
    return sequence[i++];
  };

  try {
    const res = await defaultFetchTracking("JD014600004033839702", null);
    assert.equal(res.body.data?.accepted?.length, 1);
    assert.deepEqual(paths, [
      "/gettrackinfo",
      "/register",
      "/gettrackinfo",
      "/gettrackinfo",
    ]);
  } finally {
    _internal.post = prevPost;
    _internal.repollDelayMs = prevDelay;
  }
});

// ---------------------------------------------------------------------------
// Integration — real 17Track call (runs only when SEVENTEEN_TRACK_API_KEY set)
// ---------------------------------------------------------------------------

test("real 17Track lookup for DHL 995020567586", { skip: !process.env.SEVENTEEN_TRACK_API_KEY }, async () => {
  const result = await handleTrackPackage({
    tracking_number: "995020567586",
    user_intent: "general_status",
  });
  // Accept either a populated tracking result or a known-transient error.
  // What must NOT happen: undefined structure or PII leakage.
  const hit = findForbiddenKey(result);
  assert.equal(hit, null, hit ?? undefined);
  assert.ok(result.structuredContent);
  assert.ok(Array.isArray(result._meta.events));
});
