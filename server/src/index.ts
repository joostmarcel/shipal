import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "./server.js";

if (!process.env.SEVENTEEN_TRACK_API_KEY) {
  throw new Error("SEVENTEEN_TRACK_API_KEY is required");
}

// Signal handling is owned by Skybridge's `server.run()`, which installs
// SIGTERM/SIGINT handlers that close the HTTP server and `process.exit(0)`.
// `@yavio/sdk` also installs a SIGTERM/SIGINT handler that drains buffered
// analytics over the network, but Skybridge's exit fires as soon as
// connections drain, so the final (sub-interval) batch is best-effort on
// abrupt shutdown. Steady-state events flush on the SDK's ~10s interval.

const OPENAI_APPS_CHALLENGE = "5JTGZ1w0jaEJjs1MaI5gEFX2h_1_f9u4_bAUW-FYLkk";

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

// ChatGPT caches an app's widget-template URI from the manifest it saw when the
// app was installed/submitted — it re-reads `tools/list` very rarely. Skybridge
// <1.0 published views as `ui://widgets/<host>/<name>.html`; 1.x renamed the
// namespace to `ui://views/<host>/<name>.html` (and appended a `?v=` cache
// key). Clients that installed Shipal before the 1.x upgrade still ask for the
// old URI, get `-32602 … not found`, and render "Failed to fetch template"
// after an otherwise successful tool call.
//
// Map the legacy namespace onto the current one. We only need to correct the
// path: Skybridge resolves a view by its query-less path, so the missing `?v=`
// param is fine. Runs at the Express layer because Skybridge's own resolver
// sits ahead of any `mcpMiddleware()` we could register.
const LEGACY_VIEW_URI = /^ui:\/\/widgets\/(apps-sdk|ext-apps)\/(.+)$/;

server.use(((req: any, _res: any, next: any) => {
  for (const msg of Array.isArray(req.body) ? req.body : [req.body]) {
    if (msg?.method !== "resources/read") continue;
    const uri = msg.params?.uri;
    if (typeof uri !== "string") continue;
    const match = LEGACY_VIEW_URI.exec(uri);
    if (match) msg.params.uri = `ui://views/${match[1]}/${match[2]}`;
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
