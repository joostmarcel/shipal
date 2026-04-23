import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "./server.js";

if (!process.env.SEVENTEEN_TRACK_API_KEY) {
  throw new Error("SEVENTEEN_TRACK_API_KEY is required");
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
const WEBSITE_LOGO = readFileSync(path.join(process.cwd(), "website/logo.png"));

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
      case "/logo.png":
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(WEBSITE_LOGO);
        return;
      case "/healthz":
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
