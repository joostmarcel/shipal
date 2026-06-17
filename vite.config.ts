import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { skybridge } from "skybridge/vite";
import { defineConfig, type PluginOption } from "vite";

// Skybridge 1.x runs `vite build` from the project root and emits its Vite
// manifest to <root>/dist/assets, so this config lives at the root (the Vite
// root stays the project root). The frontend itself still lives under web/, so
// point the view scanner there and alias "@" to web/src.
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    skybridge({ viewsDir: "web/src/widgets" }) as PluginOption,
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "web/src"),
    },
  },
});
