import "@/index.css";

import { mountWidget } from "skybridge/web";
import { useYavio } from "@yavio/sdk/react";
import { useToolInfo } from "../helpers.js";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { LoadingDots } from "@openai/apps-sdk-ui/components/Indicator";
import { CheckCircleFilled, Clock, MapPin, Order } from "@openai/apps-sdk-ui/components/Icon";

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
  useYavio(responseMetadata);

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

  const events = (responseMetadata?.events as TrackingEvent[] | undefined) ?? [];

  return (
    <div
      className="flex flex-col gap-3 p-4"
      data-llm={`Tracking ${output.trackingNumber}: ${output.status}. ${output.latestEvent?.description ?? "No events"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
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
              {output.daysInTransit} {output.daysInTransit === 1 ? "day" : "days"} in transit
            </span>
          )}
          {output.estimatedDelivery?.from && (
            <span>
              ETA: {formatDate(output.estimatedDelivery.from)}
              {output.estimatedDelivery.to && output.estimatedDelivery.to !== output.estimatedDelivery.from
                ? ` - ${formatDate(output.estimatedDelivery.to)}`
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

export default TrackPackage;

mountWidget(<TrackPackage />);
