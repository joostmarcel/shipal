import "@/index.css";

import { useState } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { LoadingDots } from "@openai/apps-sdk-ui/components/Indicator";
import {
  CheckCircleFilled,
  Clock,
  Home,
  MapPin,
  Order,
} from "@openai/apps-sdk-ui/components/Icon";

// Filled-style delivery-truck icon to match the visual weight of the SDK's
// Order / MapPin / Home icons. Apps SDK doesn't ship a truck icon.
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
      {/* cargo box */}
      <path d="M3 6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9H3V6z" />
      {/* cab with slanted front */}
      <path d="M15 9h3.38a1 1 0 0 1 .78.38l2.12 2.65a1 1 0 0 1 .22.62V15H15V9z" />
      {/* wheels (solid) */}
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

type TrackingEvent = {
  time: string;
  description: string;
  location: string;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: "success" | "info" | "warning" | "danger" | "secondary" }
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

const ERROR_COPY: Record<
  string,
  { title: string; description: (n: string) => string; color: "warning" | "danger" }
> = {
  invalid_tracking_number: {
    title: "Not a tracking number",
    description: (n) => `"${n}" is not a recognized tracking number format.`,
    color: "warning",
  },
  not_found: {
    title: "No tracking data yet",
    description: (n) => `No tracking data is available for ${n} yet. The carrier may not have registered it.`,
    color: "warning",
  },
  rate_limited: {
    title: "Tracking service busy",
    description: () => "The tracking service is busy right now. Please try again in a moment.",
    color: "warning",
  },
  upstream_unavailable: {
    title: "Service unavailable",
    description: () => "The tracking service is temporarily unavailable.",
    color: "danger",
  },
  api_key_invalid: {
    title: "Tracking misconfigured",
    description: () => "This app is not correctly configured to reach the tracking service.",
    color: "danger",
  },
  timeout: {
    title: "Lookup timed out",
    description: (n) => `The tracking lookup for ${n} took too long. Please try again.`,
    color: "warning",
  },
  unknown: {
    title: "Tracking error",
    description: (n) => `Could not look up ${n}.`,
    color: "danger",
  },
};

const COLLAPSE_AT = 10;

type StationDef = { label: string; Icon: React.ComponentType<{ className?: string }> };

const STATIONS: StationDef[] = [
  { label: "Shipped", Icon: Order },
  { label: "In Transit", Icon: Truck },
  { label: "Out for Delivery", Icon: MapPin },
  { label: "Delivered", Icon: Home },
];

// status → zero-based index of the currently-active station.
// Statuses not in this map suppress the progress bar entirely
// (NotFound is already handled by the Watching alert; Expired/unknown are error-ish).
export const STATUS_TO_STATION: Record<string, number> = {
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
    <div
      className="flex items-start py-1"
      role="list"
      aria-label="Delivery progress"
    >
      {STATIONS.map(({ label, Icon }, i) => {
        const passed = i < active;
        const current = i === active;
        const state = current ? "current" : passed ? "completed" : "not yet reached";

        // Circle style per step state
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
          ? isError
            ? "text-danger font-semibold"
            : "text-default font-semibold"
          : passed
            ? "text-default"
            : "text-tertiary";

        return (
          <div
            key={label}
            className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
            role="listitem"
          >
            <div className="flex items-center w-full">
              {/* line to the left of the circle */}
              <div
                className={
                  i === 0
                    ? "flex-1 bg-transparent h-[2px]"
                    : `h-[2px] flex-1 ${i <= active ? accentLine : mutedLine}`
                }
              />
              <div
                className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 transition-[box-shadow,background-color] ${circleClass}`}
                aria-label={`${label} — ${state}`}
              >
                <Icon className={iconClass} />
              </div>
              {/* line to the right of the circle */}
              <div
                className={
                  i === STATIONS.length - 1
                    ? "flex-1 bg-transparent h-[2px]"
                    : `h-[2px] flex-1 ${i < active ? accentLine : mutedLine}`
                }
              />
            </div>
            <span className={`text-xs text-center leading-tight px-0.5 ${labelClass}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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

function TrackPackage() {
  const { output, isPending, responseMetadata } = useToolInfo<"track-package">();
  const [expanded, setExpanded] = useState(false);

  if (isPending) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingDots />
      </div>
    );
  }

  if (!output) {
    return (
      <Alert
        color="warning"
        variant="soft"
        title="No data"
        description="No tracking information available."
      />
    );
  }

  if (output.error) {
    const copy = ERROR_COPY[output.error] ?? ERROR_COPY.unknown;
    return (
      <Alert
        color={copy.color}
        variant="soft"
        title={copy.title}
        description={copy.description(output.trackingNumber)}
      />
    );
  }

  const statusCfg = STATUS_CONFIG[output.status] ?? {
    label: output.status,
    color: "secondary" as const,
  };

  const rawEvents = (responseMetadata as { events?: unknown } | undefined)?.events;
  const events: TrackingEvent[] = Array.isArray(rawEvents)
    ? (rawEvents as TrackingEvent[])
    : [];

  // 17Track returns status="NotFound" with zero events for numbers the carrier
  // recognizes but has no events for yet (just-shipped, or data purged). Show a
  // friendly "watching" state instead of the scary warning badge.
  const awaitingEvents =
    output.status === "NotFound" && !output.latestEvent && events.length === 0;

  if (awaitingEvents) {
    return (
      <Alert
        color="info"
        variant="soft"
        title={output.carrier && output.carrier !== "Unknown"
          ? `Watching ${output.trackingNumber} via ${output.carrier}`
          : `Watching ${output.trackingNumber}`}
        description="The carrier hasn't reported events for this shipment yet. Check back in a few minutes — most carriers update within an hour of the first scan."
      />
    );
  }

  const visibleEvents =
    expanded || events.length <= COLLAPSE_AT ? events : events.slice(0, COLLAPSE_AT);

  return (
    <div
      className="flex flex-col p-4"
      data-llm={`Tracking ${output.trackingNumber}: ${output.status}. ${output.latestEvent?.description ?? "No events"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Order className="icon-sm shrink-0 fill-tertiary" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-default truncate">
              {output.trackingNumber}
            </span>
            {output.carrier && output.carrier !== "Unknown" && (
              <span className="text-xs text-tertiary">
                {output.carrier}
              </span>
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
              {output.daysInTransit} {output.daysInTransit === 1 ? "day" : "days"} in transit
            </span>
          )}
          {output.estimatedDelivery?.from && (
            <span>
              ETA: {formatDate(output.estimatedDelivery.from)}
              {output.estimatedDelivery.to && output.estimatedDelivery.to !== output.estimatedDelivery.from
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
            {visibleEvents.map((event, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {i === 0 ? (
                    <CheckCircleFilled className="icon-sm shrink-0 mt-0.5 fill-default" />
                  ) : (
                    <div className="icon-sm flex items-center justify-center shrink-0 mt-0.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                    </div>
                  )}
                  {i < visibleEvents.length - 1 && (
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
          {events.length > COLLAPSE_AT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-secondary hover:text-default mt-1 self-start"
            >
              {expanded ? "Show fewer" : `Show all ${events.length} events`}
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export default TrackPackage;

mountWidget(<TrackPackage />);
