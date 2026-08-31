import { serve } from "bun";
import index from "./index.html";
import admin from "../admin.html";

// In production, nginx proxies "/api/*" straight to sync-server and this
// route never runs (see sync-server/README.md, "One origin serves
// everything"). This is only for `bun run dev`, so the app works against a
// `cargo run` sync-server on localhost without needing nginx locally too.
const SYNC_SERVER_URL = process.env.ALBAS_SYNC_INTERNAL_URL ?? "http://127.0.0.1:8787";

async function proxyToSyncServer(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(url.pathname.replace(/^\/api/, "") + url.search, SYNC_SERVER_URL);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? req.body : undefined,
    // @ts-expect-error Bun's fetch requires this when streaming a request body through
    duplex: hasBody ? "half" : undefined,
  });
}

const server = serve({
  routes: {
    // Admin console — gated client-side by ALBAS_SYNC_ADMIN_TOKEN, see AdminConsole.tsx.
    "/admin": admin,
    "/admin/*": admin,

    "/api/*": proxyToSyncServer,

    // Public site: splash, login, register, offline-info. All served the same
    // shell; App.tsx picks the screen from the pathname.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
