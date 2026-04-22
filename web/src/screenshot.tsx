import "@/index.css";

import { createRoot } from "react-dom/client";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import {
  CheckCircleFilled,
  Clock,
  MapPin,
  Order,
} from "@openai/apps-sdk-ui/components/Icon";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type TrackingEvent = {
  time: string;
  description: string;
  location: string;
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
  estimatedDelivery: {
    source: string;
    from: string;
    to: string;
  } | null;
};

/* ------------------------------------------------------------------ */
/*  Shared rendering (same as real widget)                            */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: "success" | "info" | "warning" | "danger" | "secondary";
  }
> = {
  Delivered: { label: "Delivered", color: "success" },
  InTransit: { label: "In Transit", color: "info" },
  OutForDelivery: { label: "Out for Delivery", color: "info" },
  InfoReceived: { label: "Info Received", color: "secondary" },
  AvailableForPickup: { label: "Available for Pickup", color: "success" },
  DeliveryFailure: { label: "Delivery Failed", color: "danger" },
  Exception: { label: "Exception", color: "danger" },
  Expired: { label: "Expired", color: "warning" },
  NotFound: { label: "Not Found", color: "warning" },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function TrackPackageWidget({
  output,
  events,
}: {
  output: StructuredOutput;
  events: TrackingEvent[];
}) {
  if (output.error) {
    return (
      <Alert
        color="danger"
        variant="soft"
        title="Tracking error"
        description={`Could not track ${output.trackingNumber}: ${output.error}`}
      />
    );
  }

  const statusCfg = STATUS_CONFIG[output.status] ?? {
    label: output.status,
    color: "secondary" as const,
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Order className="icon-sm shrink-0 fill-tertiary" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-default truncate">
              {output.trackingNumber}
            </span>
            {output.carrier && output.carrier !== "Unknown" && (
              <span className="text-xs text-tertiary">{output.carrier}</span>
            )}
          </div>
        </div>
        <Badge color={statusCfg.color} variant="soft" size="sm" pill>
          {statusCfg.label}
        </Badge>
      </div>

      {/* Latest event */}
      {output.latestEvent && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-secondary p-3">
          <span className="text-xs font-medium text-secondary">
            Latest update
          </span>
          <span className="text-sm text-default">
            {output.latestEvent.description}
          </span>
          <div className="flex items-center gap-3 text-xs text-tertiary mt-0.5">
            {output.latestEvent.location && (
              <span className="flex items-center gap-1">
                <MapPin className="icon-xs fill-tertiary" />
                {output.latestEvent.location}
              </span>
            )}
            {output.latestEvent.time && (
              <span className="flex items-center gap-1">
                <Clock className="icon-xs fill-tertiary" />
                {formatDate(output.latestEvent.time)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Transit info */}
      {(output.daysInTransit != null || output.estimatedDelivery) && (
        <div className="flex gap-4 text-xs text-tertiary">
          {output.daysInTransit != null && (
            <span>
              {output.daysInTransit}{" "}
              {output.daysInTransit === 1 ? "day" : "days"} in transit
            </span>
          )}
          {output.estimatedDelivery?.from && (
            <span>
              ETA: {formatDate(output.estimatedDelivery.from)}
              {output.estimatedDelivery.to &&
              output.estimatedDelivery.to !== output.estimatedDelivery.from
                ? ` – ${formatDate(output.estimatedDelivery.to)}`
                : ""}
            </span>
          )}
        </div>
      )}

      {/* Event timeline */}
      {events.length > 0 && (
        <div className="flex flex-col">
          <span className="text-xs font-medium text-secondary mb-2">
            Tracking history
          </span>
          <div className="flex flex-col">
            {events.map((event, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {i === 0 ? (
                    <CheckCircleFilled className="icon-sm shrink-0 mt-0.5 fill-default" />
                  ) : (
                    <div className="icon-sm flex items-center justify-center shrink-0 mt-0.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                    </div>
                  )}
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-gray-200 my-1" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 pb-3 min-w-0">
                  <span
                    className={`text-sm ${i === 0 ? "text-default font-medium" : "text-secondary"}`}
                  >
                    {event.description}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-tertiary">
                    {event.location && <span>{event.location}</span>}
                    {event.time && <span>{formatDate(event.time)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const inTransitOutput: StructuredOutput = {
  trackingNumber: "1Z999AA10123456784",
  error: null,
  carrier: "UPS",
  status: "InTransit",
  subStatus: "InTransit_Other",
  subStatusDescription: "The shipment is in transit.",
  latestEvent: {
    time: "2026-02-25T14:32:00Z",
    description: "Departed facility",
    location: "Louisville, KY, US",
  },
  daysInTransit: 3,
  estimatedDelivery: {
    source: "carrier",
    from: "2026-02-27T00:00:00Z",
    to: "2026-02-28T00:00:00Z",
  },
};

const inTransitEvents: TrackingEvent[] = [
  {
    time: "2026-02-25T14:32:00Z",
    description: "Departed facility",
    location: "Louisville, KY, US",
  },
  {
    time: "2026-02-25T08:15:00Z",
    description: "Arrived at hub facility",
    location: "Louisville, KY, US",
  },
  {
    time: "2026-02-24T19:45:00Z",
    description: "In transit to next facility",
    location: "Chicago, IL, US",
  },
  {
    time: "2026-02-23T11:20:00Z",
    description: "Picked up",
    location: "Chicago, IL, US",
  },
  {
    time: "2026-02-22T16:05:00Z",
    description: "Shipping label created",
    location: "Chicago, IL, US",
  },
];

const deliveredOutput: StructuredOutput = {
  trackingNumber: "JD014600004033839702",
  error: null,
  carrier: "DHL",
  status: "Delivered",
  subStatus: "Delivered_Other",
  subStatusDescription: "The shipment has been delivered.",
  latestEvent: {
    time: "2026-02-24T10:48:00Z",
    description: "Delivered — signed by J. SMITH",
    location: "San Francisco, CA, US",
  },
  daysInTransit: 5,
  estimatedDelivery: null,
};

const deliveredEvents: TrackingEvent[] = [
  {
    time: "2026-02-24T10:48:00Z",
    description: "Delivered — signed by J. SMITH",
    location: "San Francisco, CA, US",
  },
  {
    time: "2026-02-24T07:30:00Z",
    description: "Out for delivery",
    location: "San Francisco, CA, US",
  },
  {
    time: "2026-02-23T22:10:00Z",
    description: "Arrived at delivery facility",
    location: "San Francisco, CA, US",
  },
  {
    time: "2026-02-22T15:05:00Z",
    description: "In transit",
    location: "Oakland, CA, US",
  },
  {
    time: "2026-02-21T09:30:00Z",
    description: "Customs cleared",
    location: "Los Angeles, CA, US",
  },
  {
    time: "2026-02-20T03:15:00Z",
    description: "Arrived at customs",
    location: "Los Angeles, CA, US",
  },
  {
    time: "2026-02-19T18:00:00Z",
    description: "Shipment picked up",
    location: "Berlin, DE",
  },
];

const exceptionOutput: StructuredOutput = {
  trackingNumber: "420331539405511206081726832767",
  error: null,
  carrier: "USPS",
  status: "DeliveryFailure",
  subStatus: "DeliveryFailure_NoOne",
  subStatusDescription:
    "Delivery attempted — no one available to sign for the package.",
  latestEvent: {
    time: "2026-02-26T11:15:00Z",
    description: "Delivery attempted — no authorized recipient available",
    location: "Brooklyn, NY, US",
  },
  daysInTransit: 4,
  estimatedDelivery: {
    source: "carrier",
    from: "2026-02-27T00:00:00Z",
    to: "2026-02-27T00:00:00Z",
  },
};

const exceptionEvents: TrackingEvent[] = [
  {
    time: "2026-02-26T11:15:00Z",
    description: "Delivery attempted — no authorized recipient available",
    location: "Brooklyn, NY, US",
  },
  {
    time: "2026-02-26T06:30:00Z",
    description: "Out for delivery",
    location: "Brooklyn, NY, US",
  },
  {
    time: "2026-02-25T20:45:00Z",
    description: "Arrived at post office",
    location: "Brooklyn, NY, US",
  },
  {
    time: "2026-02-24T14:00:00Z",
    description: "In transit to destination",
    location: "Newark, NJ, US",
  },
  {
    time: "2026-02-22T09:10:00Z",
    description: "USPS in possession of item",
    location: "Atlanta, GA, US",
  },
];

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "48px",
        padding: "48px 24px",
        background: "#f5f5f5",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: "14px",
          color: "#888",
          fontFamily: "system-ui",
          margin: 0,
        }}
      >
        Screenshot each card below at 706px &times; auto height (or 1412px for
        2x retina)
      </h1>

      {/* In Transit */}
      <div>
        <p
          style={{
            fontSize: "12px",
            color: "#999",
            fontFamily: "system-ui",
            marginBottom: "8px",
          }}
        >
          1 &mdash; In Transit (UPS)
        </p>
        <div
          className="oai-sdk-ui"
          style={{
            width: "706px",
            background: "white",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <TrackPackageWidget
            output={inTransitOutput}
            events={inTransitEvents}
          />
        </div>
      </div>

      {/* Delivered */}
      <div>
        <p
          style={{
            fontSize: "12px",
            color: "#999",
            fontFamily: "system-ui",
            marginBottom: "8px",
          }}
        >
          2 &mdash; Delivered (DHL)
        </p>
        <div
          className="oai-sdk-ui"
          style={{
            width: "706px",
            background: "white",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <TrackPackageWidget
            output={deliveredOutput}
            events={deliveredEvents}
          />
        </div>
      </div>

      {/* Delivery Failure */}
      <div>
        <p
          style={{
            fontSize: "12px",
            color: "#999",
            fontFamily: "system-ui",
            marginBottom: "8px",
          }}
        >
          3 &mdash; Delivery Failed (USPS)
        </p>
        <div
          className="oai-sdk-ui"
          style={{
            width: "706px",
            background: "white",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <TrackPackageWidget
            output={exceptionOutput}
            events={exceptionEvents}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
