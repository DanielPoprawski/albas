# Albas Web Console — Implementation Guide

## Overview

The web console is a **read-only** Bun + React interface for Albas synced data, served at `albas.danni-dev.com/`. It must remain stateless, fetch everything from `/api/sync`, and never parse app data — same principle as `sync-server/` itself.

## Key Constraints

- **Read-only:** No mutations; every data structure is immutable, sourced from `/sync`. State is append-only.
- **No server-side rendering of user data:** Never embed rows in HTML templates. Fetch them, render them client-side.
- **Same origin as the sync server:** No CORS layer, WebAuthn RP ID is this exact domain, not a subdomain or apex.
- **Token handling:** Bearer token (minted on passkey login) stored in `localStorage`, validated on page load, discarded on logout. Never expose it in URLs or logs.
- **Theme consistency:** Use the same `--t-*` design tokens as the main app. Both respond to `data-theme` or `prefers-color-scheme`.

## Project Layout

```
web/
├── src/
│   ├── index.ts              # Bun entry point; serves index.html and routes API calls
│   ├── frontend.tsx          # React root component
│   ├── pages/                # Page components (Dashboard, Calendar, Todos)
│   ├── components/           # Reusable UI pieces (EventCard, TodoRow, etc.)
│   ├── hooks/                # useAuth, useSync, etc.
│   ├── types/web.ts          # Type definitions (mirror of app's types where needed)
│   ├── styles/web.css        # Tailwind v4 setup; import --t-* tokens from main app
│   └── api/                  # Fetch wrappers for /api endpoints
├── index.html                # Static HTML shell
├── package.json              # Bun project config (separate from root)
└── bun.lockb                 # Bun lockfile (separate from root)
```

## Bun Setup

Use Bun, not npm:

```bash
bun install
bun run dev        # development with HMR
bun run build      # production bundle
bun start          # run production build
```

- `bun:sqlite` for any local caching (not synced data)
- `Bun.serve()` for the server; no express
- `Bun.file()` for file I/O, not `fs`
- HTML imports work natively; no bundler config needed

## Authentication & Session

- **Welcome route:** Passkey ceremony via Tauri plugin? No — the web console runs in a browser with no Tauri. Use `WebAuthn.isUserVerifyingPlatformAuthenticatorAvailable()` and vanilla `navigator.credentials.get()` for security keys/biometrics.
- **Token flow:** `POST /login/start` → challenge, `POST /login/finish` → token. Store token in `localStorage['albas-session']`.
- **Validation on load:** Check token with `GET /health` or a minimal `/sync` call before rendering the app.
- **Logout:** Delete the token from `localStorage` and redirect to Welcome.

## Fetching & Caching

All data flows through `/sync`:

```ts
// First load: include `since: 0` to get a full snapshot
const response = await fetch('/api/sync', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ since: 0, sharedSince: 0, grantRev: 0, changes: [] })
});
// { seq, changes, shared, sharedSeq, grantRev }

// Store seq, sharedSeq, grantRev in state
// On next sync, send { since: seq, sharedSince: sharedSeq, grantRev, changes: [] }
// Apply `changes` and `shared` rows; these are the only updates
```

**Never** call `/api` endpoints directly for data — they don't exist. Everything goes through `/sync`.

## Types

Mirror only what the console needs from the app:

```ts
// web/src/types/web.ts
export type CalendarEvent = {
  id: string;
  title: string;
  startDate: string; // ISO 8601
  endDate: string;
  allDay: boolean;
  color?: string;
  sharedBy?: string; // if from another account
};

export type Todo = {
  id: string;
  title: string;
  due?: string;
  completed: boolean;
  category?: string;
  important: boolean;
  sharedBy?: string;
};

// Never import from the main app's types.ts — maintain independence.
```

## Theming

The main app defines tokens in `src/App.css`. The web console **does not** import that file directly (CORS + bundler issues). Instead:

1. **Host copies the token definitions** to `web/src/styles/web.css` (or generates them from a shared source).
2. **Both projects define the full `--t-*` palette** on `:root` (light) and `[data-theme='dark']`.
3. **Tailwind v4 `@theme inline` block** aliases shadcn/Tailwind names onto them.
4. **JavaScript toggles `data-theme`** based on user choice or `prefers-color-scheme`.

```css
/* web/src/styles/web.css */
:root {
  --t-surface: #ffffff;
  --t-accent: #2563eb;
  /* ... etc ... */
}

[data-theme='dark'] {
  --t-surface: #0a0a0a;
  --t-accent: #60a5fa;
  /* ... etc ... */
}
```

The browser respects `color-scheme` per theme, so native date pickers stay legible.

## Shared Data

Shared rows arrive in `shared` key with `from` field (owner account name):

```ts
// In /sync response
{
  "shared": [
    { "from": "sarah", "tbl": "events", "pk": "e1", "payload": { /* ... */ } }
  ]
}

// Render with attribution, dimmed styling, read-only (no edit buttons)
<EventCard {...event} sharedBy="sarah" readOnly />
```

Use `sharedDisplay.ts` logic from the main app (copy it; don't import) to apply the right styling and tooltip.

## What NOT to Do

- ❌ **Don't hardcode user data.** If a screen shows "Sarah's calendar," that must come from the actual account data, not a template.
- ❌ **Don't add E2E encryption here.** The console never decrypts; it renders plaintext rows as-is.
- ❌ **Don't store passwords or tokens in a cookie.** `localStorage` is fine for a single-device session; HTTPS is mandatory.
- ❌ **Don't parse payloads.** A row's `payload` is opaque JSON; render it as-is, don't assume a shape.
- ❌ **Don't use express, Next.js, or any full-stack framework.** Bun's `Bun.serve()` is the server; React is the frontend; they live in one `index.ts`.

## Deployment

The console is deployed by the same CI pipeline that publishes `sync-server/`. Updates land automatically on `albas.danni-dev.com` when `web/src/**` changes.

nginx forwards requests to the Bun app running on `127.0.0.1:3000`. The TLS terminating reverse proxy is shared with `sync-server/`.

## Testing

```bash
bun test            # unit tests in .test.ts files
```

For integration tests against a live `sync-server`, set `ALBAS_SYNC_TEST_URL` and use the same token protocol as the app (see `sync-server/README.md`).

## Maintenance & Sync Protocol Updates

When `sync.rs` (`src-tauri/src/sync.rs`) changes:
1. **TABLES** additions → mirror in `web/src/types/web.ts` if the console will display them.
2. **Payment protocol changes** → update the fetch wrapper in `web/src/api/sync.ts`.
3. **Share group changes** → update the render logic in components.

The server is the source of truth; the console is a client and must adapt when the protocol changes.
