import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "./server.js";
import { attachAnalytics, flushAnalytics } from "./analytics.js";

if (!process.env.SEVENTEEN_TRACK_API_KEY) {
  throw new Error("SEVENTEEN_TRACK_API_KEY is required");
}

attachAnalytics();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    flushAnalytics().finally(() => process.exit(0));
  });
}

const OPENAI_APPS_CHALLENGE = "7GfhhbWTu5XtqH_hsZq8REfBcNXJJW2ywnqmrIogwNM";

const ICON_SVG = readFileSync(
  path.join(process.cwd(), "server/assets/icon.svg"),
  "utf-8",
);
const WEBSITE_HTML = readFileSync(
  path.join(process.cwd(), "website/index.html"),
  "utf-8",
);
const PRIVACY_HTML = readFileSync(
  path.join(process.cwd(), "website/privacy.html"),
  "utf-8",
);
const WEBSITE_LOGO = readFileSync(path.join(process.cwd(), "website/logo.png"));

// Cloud Run terminates TLS at the frontend; the container sees plain HTTP.
// Hono (used by the MCP SDK's StreamableHTTP transport) decides the URL
// scheme from req.socket.encrypted, which is false in this environment, so
// requestInfo.url ends up as http://… and Claude's widget-domain check
// (sha256 of the connector URL) mismatches the public https URL.
// Force Hono to use the canonical https URL by rewriting req.originalUrl
// to an absolute URL. Skybridge's mcpMiddleware copies originalUrl onto
// req.url before invoking the transport, and Hono's newRequest takes the
// absolute-URL short-circuit (no scheme detection) when req.url already
// starts with http(s)://.
server.use(((req: any, _res: any, next: any) => {
  if (
    req.headers["x-forwarded-proto"] === "https" &&
    typeof req.originalUrl === "string" &&
    req.originalUrl.startsWith("/")
  ) {
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined);
    if (host) {
      req.originalUrl = `https://${host}${req.originalUrl}`;
    }
  }
  next();
}) as any);

server
  .use("/assets/icon.svg", ((_req: any, res: any) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(ICON_SVG);
  }) as any)
  .use("/", ((req: any, res: any, next: any) => {
    if (req.method !== "GET") return next();

    switch (req.url) {
      case "/":
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(WEBSITE_HTML);
        return;
      case "/privacy":
      case "/privacy.html":
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.end(PRIVACY_HTML);
        return;
      case "/logo.png":
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(WEBSITE_LOGO);
        return;
      case "/health":
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end('{"ok":true}');
        return;
      case "/.well-known/openai-apps-challenge":
        res.setHeader("Content-Type", "text/plain");
        res.end(OPENAI_APPS_CHALLENGE);
        return;
      default:
        return next();
    }
  }) as any);

server.run();

export type { AppType } from "./server.js";
