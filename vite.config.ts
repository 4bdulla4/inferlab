import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const API_PORT = process.env.API_PORT ?? "8790";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: {
      // Saving API keys rewrites `.env`; without this Vite would full-reload the
      // page mid-session and wipe in-memory session keys. The API server reloads
      // `.env` on its own, so the browser needs no reload.
      ignored: ["**/.env", "**/.env.*"],
    },
    proxy: {
      // All provider calls go through the backend. API keys never reach the browser.
      "/api": {
        // 127.0.0.1, not "localhost": the API listens on IPv4 loopback only, and
        // "localhost" can resolve to ::1 first.
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
