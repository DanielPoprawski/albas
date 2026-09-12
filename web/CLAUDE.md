# Albas Web — Implementation Guide

## Overview

`web/` is a Bun + React app serving **the public site** on `albas.danni-dev.com` (`/`,
`/login`, `/register`, `/offline`) — splash screen, password sign-in (primary, + TOTP if
enrolled) with passkey as the alternative, password registration (the mandatory first
credential), a signed-in page that adds passkeys, and an offline-usage explainer. Built from
`App.tsx` / `frontend.tsx`, styled by plain CSS in `src/index.css`.

**There is no admin console here.** Server administration is the `albas-sync admin` CLI run
inside the container (`sync-server/src/admin.rs`, `sync-server/scripts/admin.sh`; see
`sync-server/README.md`, "Admin CLI"). The web console, its `/admin` route, and the
`/accounts`, `/admin/*` and `/invites` HTTP routes it called were removed in 2026-09 — don't
rebuild them.

A **read-only viewer of a signed-in account's own synced calendar/todo data** (browsing your
events and to-dos from a browser) is still on the roadmap but is a separate, later piece of
work — not part of this build. The public site today stops at "signed in, here's your
session, log out." Don't build a data-fetching dashboard here without checking that plan is
still current.

## Key Constraints

- **Same origin as the sync server.** No CORS layer, and the WebAuthn RP ID is this exact
  domain — not a subdomain or the apex. See root `CLAUDE.md`, "Data & sync invariants".
- **Token handling:** the session token (minted on passkey/password login) lives in
  `localStorage['albas-session']`. There is no admin token anywhere in this app.
- **Passkey login is discoverable (usernameless).** `POST /login/start` takes no body and no
  username; the authenticator itself identifies the account from a resident credential. Don't
  add an "Account Name" field to the passkey login form — there is nothing on the server to
  check it against, and the real ceremony doesn't use one. (Registration and password login
  *do* take a name — only discoverable login is usernameless.)
- **No hardcoded data, anywhere.** Every account name, token, share, or row shown must come
  from a real `sync-server` response.

## Project Layout

```
web/
├── src/
│   ├── index.ts               # Bun.serve() — routes "/" and its screens to index.html,
│   │                           #   proxies "/api/*" in dev
│   ├── index.html             # public site HTML shell -> frontend.tsx
│   ├── frontend.tsx           # public site React root -> App.tsx
│   ├── App.tsx                # `Screen` type, paths, and the splash/login/register/offline/signed-in router
│   ├── index.css              # public site styling
│   ├── components/
│   │   └── auth/               # Splash (+Logo, OfflineInfo), LoginScreen (PasswordLogin, PasskeyLogin,
│   │                           #   GoogleSignInButton), RegisterForm, SignedIn
│   ├── lib/
│   │   ├── webauthn.ts         # base64url <-> ArrayBuffer, and the create()/get() ceremony wrappers
│   │   └── api.ts              # `request()` + `ApiError`, and one function per endpoint the site calls
├── build.ts                    # bun build -> dist/, index.html entrypoint
├── package.json                # Bun project config (separate from root)
└── bun.lock                    # Bun lockfile (separate from root)
```

## Bun Setup

Use Bun, not npm:

```bash
bun install
bun run dev        # development with HMR (bun --hot src/index.ts)
bun run build      # production bundle (bun run build.ts -> dist/)
bun start           # run the production build (NODE_ENV=production bun src/index.ts)
```

- `Bun.serve()` for the server; no express, no Next.js.
- HTML imports work natively (`index.ts` imports `../index.html` directly) — no bundler
  config at all. **No Tailwind, no shadcn, no component library**: the only dependencies are
  React and its types; `knip` (root `bun run knip`) fails CI on an unused one.

## The public site: auth flows

All three credential types are already implemented server-side (`sync-server/src/passkey.rs`,
`password.rs`, `totp.rs`) — this app is a client for them, not a place to invent new auth
logic. Endpoints below are called as `/api/...`; nginx strips the `/api` prefix before it
reaches `sync-server`, so `main.rs`'s routes are unprefixed.

- **Register**: `POST /api/register/password {name, password, invite?}` → `{name, token}`.
  A password is the mandatory first credential; `/register/start|finish` (passkey signup)
  still exists server-side but the site no longer offers it.
- **Password login**: `POST /api/login/password {name, password, code?}` → `{name, token}`.
  **428** means: show a TOTP code field and retry with `code` set (older servers said 401
  with the body `"A two-factor code is required."`; `loginWithPassword` matches both).
- **Passkey login**: `POST /api/login/start` (no body) → `{authId, options}`. Then
  `POST /api/login/finish {authId, label?, credential}` → `{name, token}`. `PasskeyLogin`
  prefetches the challenge on mount so `navigator.credentials.get()` runs synchronously in the
  click — WebKit drops the gesture across an `await` and rejects with NotAllowedError.
- **Add a passkey** (signed-in page): `POST /api/passkeys/start` (bearer) → `{regId, options}`
  (`options` is base64url per `webauthn-rs` — decode with `lib/webauthn.ts`), then
  `POST /api/passkeys/finish {regId, credential}`. `GET /api/passkeys` lists them.
- **Google**: `GET /api/auth/config` says whether Google is configured (the button only renders
  when it is); the button navigates to `/api/auth/google/start`, and the callback lands back
  here with a ticket that `claimGoogleTicket` exchanges for a session.
- **`#linked=<nonce>`** on `/login`: a "link another device" QR opened by a camera app. The
  nonce is only usable from inside the Albas app; the page just says so. It rides in the URL
  fragment so it never reaches an access log; `paramFromHashOrQuery` accepts the old
  `?linked=` query form for one more release. `#app_session=` (the app's browser sign-in
  handoff) works the same way.
- **Session**: once signed in, `localStorage['albas-session'] = {name, token}`. The signed-in
  view shows the account name and a Log Out button (clears the key); it does not need to
  re-validate the token against the server on load — an expired/revoked token just fails the
  next authenticated call, which is rare here since this page makes none after login.

Registration has **no invite-code field** by design: signups are open, and invites only
bootstrap existing accounts (root `CLAUDE.md`, "Auth invariants"). Don't add it back.

## Theming

The public site ships as a **single, deliberately un-themed** design — flat white/purple —
rather than the main app's `--t-*` light/dark token system. Its colours are the `--*` custom
properties at the top of `src/index.css` (same values as the app's light palette, named once;
never write a hex below that block). **No inline `style={}`**: the CSP is `style-src 'self'`
(`sync-server/nginx/tls.conf`), so an inline style is silently dropped in production — add a
class to `index.css` (`.btn-block`, `.copy-muted`, `.code-block`, `.mt-2/.mt-3` exist). The
`--t-*` system is Tauri-app-specific (root `CLAUDE.md`, "Frontend rules"); this app doesn't
import it. If dark mode is wanted here later, that's a new design decision, not a token swap.

Fonts (`Outfit`, `Sora`) are self-hosted variable TTFs in `src/fonts/`, declared with
`@font-face` at the top of `index.css`; Bun inlines them as `data:` URIs, which is why the CSP's
`font-src` lists `data:`. A Google Fonts `<link>` or `@import` would be blocked by that CSP.

## What NOT to Do

- ❌ **Don't add an Invites panel or invite-code field.** Signups are open by design.
- ❌ **Don't add a username field to passkey login.** It's discoverable/usernameless by design.
- ❌ **Don't rebuild an admin console or an admin token.** Administration is the
  `albas-sync admin` CLI; there are no admin HTTP routes to call.
- ❌ **Don't use express, Next.js, or any full-stack framework.** `Bun.serve()` is the server.

## Deployment

Deployed by `sync-server/scripts/publish.sh` alongside the server image; nginx serves the
built `dist/` at `/` (see `sync-server/nginx/`) and strips `/api` before proxying to
`sync-server` itself. Both apps share one TLS-terminating reverse proxy.

## Testing

```bash
bun test            # unit tests in .test.ts files, if/when added
```

For a live end-to-end check against a real `sync-server`, run one locally
(`cd sync-server && cargo run`, with `ALBAS_SYNC_TOKEN` or `ALBAS_SYNC_ORIGIN` set so it has a
way to end up with an account — default address
`127.0.0.1:8787`) and `bun run dev` here. `src/index.ts` proxies `/api/*` to
`ALBAS_SYNC_INTERNAL_URL` (default `http://127.0.0.1:8787`) itself in dev, stripping the
`/api` prefix the same way nginx does in production — no local nginx needed. In production
that route never runs; nginx gets there first.

## Maintenance & Protocol Updates

When the sync-server router (`main.rs`) or `passkey.rs`/`password.rs`/`totp.rs`/`google.rs`
change:
1. A new/changed field on an existing response → update the inline shape in `lib/api.ts`.
2. Admin-side changes (`*_db` functions, `admin.rs`) never touch this app — there is no admin
   surface here.

`sync-server` is the source of truth for the wire protocol; this app is a client and adapts
when it changes, never the other way around.
