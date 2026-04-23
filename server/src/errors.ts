export type ErrorCode =
  | "invalid_tracking_number"
  | "not_found"
  | "rate_limited"
  | "upstream_unavailable"
  | "api_key_invalid"
  | "timeout"
  | "unknown";

export type UpstreamResponse = {
  code?: number;
  data?: {
    accepted?: Array<unknown>;
    rejected?: Array<{ error?: { code?: number; message?: string } }>;
  };
};

export function classify17TrackError(
  body: UpstreamResponse,
  httpStatus: number,
): ErrorCode {
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "upstream_unavailable";
  if (httpStatus === 401 || httpStatus === 403) return "api_key_invalid";

  const topCode = body?.code;
  if (topCode === -18010) return "api_key_invalid";
  if (topCode === -18019 || topCode === -18020) return "rate_limited";
  if (typeof topCode === "number" && topCode !== 0) return "upstream_unavailable";

  const rejection = body?.data?.rejected?.[0]?.error?.code;
  if (rejection === -2 || rejection === -1) return "invalid_tracking_number";
  if (rejection === -3 || rejection === -4) return "not_found";
  if (typeof rejection === "number") return "invalid_tracking_number";

  return "unknown";
}

export function errorMessage(code: ErrorCode, trackingNumber: string): string {
  switch (code) {
    case "invalid_tracking_number":
      return `"${trackingNumber}" is not a recognized tracking number format.`;
    case "not_found":
      return `No tracking data found for ${trackingNumber} yet. The carrier may not have registered it.`;
    case "rate_limited":
      return "Tracking service is busy. Please try again in a moment.";
    case "upstream_unavailable":
      return "Tracking service is temporarily unavailable.";
    case "api_key_invalid":
      return "Tracking service is misconfigured.";
    case "timeout":
      return "Tracking lookup timed out.";
    default:
      return `Could not look up ${trackingNumber}.`;
  }
}
