import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "skybridge/server";
import { withYavio } from "@yavio/sdk";
import { z } from "zod";

const SEVENTEEN_TRACK_API_KEY = process.env.SEVENTEEN_TRACK_API_KEY ?? "";

const ICON_SVG = readFileSync(
  path.join(process.cwd(), "server/assets/icon.svg"),
  "utf-8",
);

const WEBSITE_HTML = readFileSync(
  path.join(process.cwd(), "website/index.html"),
  "utf-8",
);

const WEBSITE_LOGO = readFileSync(
  path.join(process.cwd(), "website/logo.png"),
);

type TrackingEvent = {
  time_iso: string;
  time_utc: string;
  description: string;
  location: string;
  stage: string;
};

type TrackingProvider = {
  provider: {
    key: number;
    name: string;
    tel: string;
    homepage: string;
    country: string;
  };
  events: TrackingEvent[];
};

type TrackInfoResponse = {
  code: number;
  data: {
    accepted: Array<{
      number: string;
      carrier: number;
      param: unknown;
      tag: string;
      track_info: {
        shipping_info: {
          shipper_address: {
            country: string;
            state: string;
            city: string;
            street: string;
            postal_code: string;
          };
          recipient_address: {
            country: string;
            state: string;
            city: string;
            street: string;
            postal_code: string;
          };
        };
        latest_status: {
          status: string;
          sub_status: string;
          sub_status_descr: string;
        };
        latest_event: TrackingEvent;
        time_metrics: {
          days_after_order: number;
          days_of_transit: number;
          days_after_last_update: number;
          estimated_delivery_date: {
            source: string;
            from: string;
            to: string;
          };
        };
        milestone: Array<{
          key_stage: string;
          time_iso: string;
          time_utc: string;
        }>;
        misc_info: {
          risk_factor: number;
          service_type: string;
          weight_raw: string;
          weight_kg: string;
          pieces: string;
          dimensions: string;
          customer_number: string;
          reference_number: string;
          local_number: string;
          local_provider: string;
          local_key: number;
        };
        tracking: {
          providers: TrackingProvider[];
        };
      };
    }>;
    rejected: Array<{
      number: string;
      error: { code: number; message: string };
    }>;
  };
};

type StructuredOutput = {
  trackingNumber: string;
  error: string | null;
  carrier: string;
  status: string;
  subStatus: string;
  subStatusDescription: string;
  latestEvent: {
    time: string;
    description: string;
    location: string;
  } | null;
  daysInTransit: number | null;
  estimatedDelivery: { source: string; from: string; to: string } | null;
};

async function fetchTracking(
  trackingNumber: string,
): Promise<TrackInfoResponse> {
  const body = [{ number: trackingNumber }];

  const res = await fetch(
    "https://api.17track.net/track/v2.4/getrealtimetrackinfo",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "17token": SEVENTEEN_TRACK_API_KEY,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`17Track API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<TrackInfoResponse>;
}

function emptyResult(trackingNumber: string, error: string): StructuredOutput {
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

const server = withYavio(
  new McpServer(
    {
      name: "yavio-package-tracking",
      version: "0.0.1",
      icons: [{ src: "/assets/icon.svg", mimeType: "image/svg+xml" }],
    },
    { capabilities: {} },
  ),
).use("/assets/icon.svg", ((_req: any, res: any) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=31536000");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(ICON_SVG);
}) as any).use("/", ((req: any, res: any, next: any) => {
  if (req.method === "GET" && req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(WEBSITE_HTML);
    return;
  }
  if (req.method === "GET" && req.url === "/logo.png") {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.end(WEBSITE_LOGO);
    return;
  }
  if (req.method === "GET" && req.url === "/.well-known/openai-apps-challenge") {
    res.setHeader("Content-Type", "text/plain");
    res.end("7GfhhbWTu5XtqH_hsZq8REfBcNXJJW2ywnqmrIogwNM");
    return;
  }
  next();
}) as any).registerWidget(
  "track-package",
  {
    description: "Track a package shipment",
    _meta: {
      ui: {
        csp: {
          connectDomains: [
            process.env.YAVIO_ENDPOINT?.replace(/\/v1\/events$/, "") ?? "",
          ].filter(Boolean),
          resourceDomains: ["https://cdn.openai.com"],
        },
      },
    },
  },
  {
    description:
      'Use this when the user wants to track a package, check a delivery status, or look up a shipment. Accepts any tracking number from any carrier worldwide (DHL, FedEx, UPS, USPS, Royal Mail, DPD, GLS, Hermes, China Post, Japan Post, Australia Post, and 2000+ more). The carrier is auto-detected from the tracking number — do not ask the user which carrier they are using. Returns the current shipment status (e.g., in transit, out for delivery, delivered, exception), carrier name, tracking event history with timestamps and locations, and estimated delivery date where available. Requires exactly one tracking number per call; for multiple packages, call this tool once per tracking number. If the tracking number is not found or not yet registered, the response will indicate no results. Do not fabricate or assume tracking data — only return information provided by the API response.',
    inputSchema: {
      tracking_number: z
        .string()
        .min(5)
        .max(50)
        .describe('The package tracking number to look up (e.g., "1Z999AA10123456784", "JD014600004033839702").'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async ({ tracking_number: trackingNumber }) => {
    const response = await fetchTracking(trackingNumber);

    if (response.data.rejected.length > 0) {
      const rejection = response.data.rejected[0];
      const structuredContent: StructuredOutput = emptyResult(
        trackingNumber,
        rejection.error.message,
      );
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `Could not track package ${trackingNumber}: ${rejection.error.message}`,
          },
        ],
        _meta: { events: [] as Array<{ time: string; description: string; location: string }> },
      };
    }

    if (response.data.accepted.length === 0) {
      const structuredContent: StructuredOutput = emptyResult(
        trackingNumber,
        "No tracking data found",
      );
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `No tracking data found for ${trackingNumber}.`,
          },
        ],
        _meta: { events: [] as Array<{ time: string; description: string; location: string }> },
      };
    }

    const item = response.data.accepted[0];
    const info = item.track_info;

    const allEvents: TrackingEvent[] = [];
    for (const provider of info.tracking?.providers ?? []) {
      for (const event of provider.events ?? []) {
        allEvents.push(event);
      }
    }

    allEvents.sort(
      (a, b) => new Date(b.time_iso).getTime() - new Date(a.time_iso).getTime(),
    );

    const carrierName =
      info.tracking?.providers?.[0]?.provider?.name ?? "Unknown";

    const structuredContent: StructuredOutput = {
      trackingNumber,
      error: null,
      carrier: carrierName,
      status: info.latest_status?.status ?? "Unknown",
      subStatus: info.latest_status?.sub_status ?? "",
      subStatusDescription: info.latest_status?.sub_status_descr ?? "",
      latestEvent: info.latest_event
        ? {
            time: info.latest_event.time_iso,
            description: info.latest_event.description,
            location: info.latest_event.location,
          }
        : null,
      daysInTransit: info.time_metrics?.days_of_transit ?? null,
      estimatedDelivery: info.time_metrics?.estimated_delivery_date ?? null,
    };

    const statusText = info.latest_status?.status ?? "Unknown";
    const latestDesc = info.latest_event?.description ?? "No events yet";

    return {
      structuredContent,
      content: [
        {
          type: "text" as const,
          text: `Package ${trackingNumber} via ${carrierName}: ${statusText}. Latest: ${latestDesc}`,
        },
      ],
      _meta: {
        events: allEvents.map((e) => ({
          time: e.time_iso,
          description: e.description,
          location: e.location,
        })),
      },
    };
  },
);

server.run();

export type AppType = typeof server;
