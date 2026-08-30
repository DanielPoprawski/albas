# Albas Web Console

The **public web console** served at `albas.danni-dev.com/` (alongside the `/api` sync endpoint). Provides a read-only interface for viewing synced calendar events and to-dos from the desktop/mobile app.

## Current Status

**Implementation:** In progress. The web console is under active development with foundational authentication and data-fetching infrastructure in place. Initial feature set focuses on calendar and to-do viewing.

**Deployment:** Bun-based frontend deployed to `albas.danni-dev.com` on the same host as `sync-server/`, served by nginx via the same TLS terminating reverse proxy.

## Architecture

- **Frontend:** React + TypeScript + Tailwind v4, built with Bun
- **Backend:** Requests routed through the same nginx proxy that fronts `sync-server/`
- **Authentication:** Uses the same Albas account + passkey system as the app — users sign in with WebAuthn to view their own data
- **Data:** Fetches read-only snapshots from `/api/sync` using the same bearer token protocol as the mobile/desktop app

The app sends its full dataset on first load, so the console is genuinely read-only and never parses payloads — the server is the source of truth and the browser cache is ephemeral.

## Development

```bash
cd web
bun install
bun run dev
```

The dev server runs on `localhost:3000` by default.

## Routing & Pages

- `/` — Dashboard (currently a placeholder)
- `/calendar` — Read-only calendar view of synced events
- `/todos` — Read-only to-do/habit list

Authentication is handled on the Welcome route before reaching any page.

## Design Consistency

The web console shares Tailwind v4 tokens with the desktop/mobile app via the same `--t-*` CSS custom properties (defined in `src/App.css` in the main app). Both respond to theme changes — the user's browser `prefers-color-scheme`, or an explicit `data-theme` override.

## Key Implementation Notes

- **No local state management needed** — data flows directly from `/sync` to component rendering. After the initial snapshot, the console is append-only and stateless.
- **Authentication** — Session persists in a bearer token stored in `localStorage`. On page load, the token is validated against `/health` or a fresh `/sync` call.
- **Sharing** — Shared data (calendar/to-dos from other users) arrives in the `/sync` response under the `shared` key, namespaced by owner (`${account}:${pk}`). Display these alongside owned data.

## Security

- **Bearer tokens are HTTPS-only** — the TLS reverse proxy is mandatory, never optional.
- **No server-side rendering of user data** — the console is a static app that fetches encrypted or plaintext rows, never a page that renders server-generated HTML with embedded data.
- **Token rotation** — Tokens never leave the app except over HTTPS; they are scoped per device (minted on login) and can be revoked per-device.

## Performance

- Large datasets are paginated or virtualized at the component level (not a server concern)
- The `/sync` endpoint returns the full snapshot on first connect; subsequent pulls are incremental
- CSS is tree-shaken at build time via Tailwind v4; JavaScript is minified and tree-shaken by Bun's bundler
