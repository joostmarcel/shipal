import { test } from "node:test";
import assert from "node:assert/strict";

import {
  _internal,
  handleTrackPackage,
  scrubLocation,
  type FetchTrackingResult,
} from "../server/src/server.js";
import { classify17TrackError } from "../server/src/errors.js";

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
