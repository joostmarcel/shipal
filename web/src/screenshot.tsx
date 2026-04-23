import "@/index.css";

import { createRoot } from "react-dom/client";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import {
  CheckCircleFilled,
  Clock,
  Home,
  MapPin,
  Order,
} from "@openai/apps-sdk-ui/components/Icon";

function Truck({ className }: { className?: string }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9H3V6z" />
      <path d="M15 9h3.38a1 1 0 0 1 .78.38l2.12 2.65a1 1 0 0 1 .22.62V15H15V9z" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

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

type StationDef = { label: string; Icon: React.ComponentType<{ className?: string }> };

const STATIONS: StationDef[] = [
  { label: "Shipped", Icon: Order },
  { label: "In Transit", Icon: Truck },
  { label: "Out for Delivery", Icon: MapPin },
  { label: "Delivered", Icon: Home },
];

const STATUS_TO_STATION: Record<string, number> = {
  InfoReceived: 0,
  InTransit: 1,
  OutForDelivery: 2,
  AvailableForPickup: 2,
  DeliveryFailure: 2,
  Exception: 1,
  Delivered: 3,
};

const ERROR_STATUSES = new Set(["DeliveryFailure", "Exception"]);

function StationsBar({ status }: { status: string }) {
  const active = STATUS_TO_STATION[status];
  if (active === undefined) return null;
  const isError = ERROR_STATUSES.has(status);
  const accentLine = isError ? "bg-danger-solid" : "bg-primary-solid";
  const mutedLine = "bg-surface-tertiary";
  return (
    <div className="flex items-start py-1" role="list" aria-label="Delivery progress">
      {STATIONS.map(({ label, Icon }, i) => {
        const passed = i < active;
        const current = i === active;
        let circleClass: string;
        let iconClass: string;
        if (current) {
          circleClass = isError
            ? "bg-danger-solid ring-4 ring-danger"
            : "bg-primary-solid ring-4 ring-primary";
          iconClass = "icon-md text-inverse";
        } else if (passed) {
          circleClass = isError ? "bg-danger-soft" : "bg-primary-soft";
          iconClass = isError ? "icon-md text-danger" : "icon-md text-primary";
        } else {
          circleClass = "bg-surface border border-subtle";
          iconClass = "icon-md text-tertiary";
        }
        const labelClass = current
          ? isError ? "text-danger font-semibold" : "text-default font-semibold"
          : passed ? "text-default" : "text-tertiary";
        return (
          <div key={label} className="flex-1 flex flex-col items-center gap-1.5 min-w-0" role="listitem">
            <div className="flex items-center w-full">
              <div className={i === 0 ? "flex-1 bg-transparent h-[2px]" : `h-[2px] flex-1 ${i <= active ? accentLine : mutedLine}`} />
              <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${circleClass}`}>
                <Icon className={iconClass} />
              </div>
              <div className={i === STATIONS.length - 1 ? "flex-1 bg-transparent h-[2px]" : `h-[2px] flex-1 ${i < active ? accentLine : mutedLine}`} />
            </div>
            <span className={`text-xs text-center leading-tight px-0.5 ${labelClass}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
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
    <div className="flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
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

      {/* Progress stations — visual hero */}
      <div className="pb-5 border-b border-subtle">
        <StationsBar status={output.status} />
      </div>

      {/* Details block — secondary to the diagram */}
      <div className="flex flex-col gap-3 pt-4">
      {/* Latest event */}
      {output.latestEvent && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-secondary p-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-tertiary">
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
          <span className="text-[10px] font-medium uppercase tracking-wide text-tertiary mb-2">
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
