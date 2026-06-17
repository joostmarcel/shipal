// Runtime entry point.
//
// Skybridge 1.x runs/bundles the compiled server at `dist/server.js` (the
// generated `dist/__entry.js` does `import("./server.js")`). With `rootDir: "."`
// this file compiles to exactly `dist/server.js`. The actual app — Express
// middleware, static routes, `server.run()` — lives in server/src/index.ts;
// importing it here runs it as a side effect.
import "./server/src/index.js";
