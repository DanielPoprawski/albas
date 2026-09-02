# Albas Web — Implementation Guide

## Overview

`web/` is a Bun + React app serving **two** distinct surfaces on `albas.danni-dev.com`:

1. **The public site** (`/`, `/login`, `/register`, `/offline`) — splash screen, passkey
   sign-in (primary) with password+TOTP as a backup method, passkey registration, and an
   offline-usage explainer. Built from `App.tsx` / `frontend.tsx`, styled from
   `designs/Albas Splash & Auth.dc.html`.
2. **The admin console** (`/admin`) — staff-only server administration: accounts, sharing
   grants, and a read-only browse of the sync `rows` table. Built from `AdminConsole.tsx` /
   `admin-frontend.tsx`, styled from `designs/Albas Admin Console.dc.html`, gated by
   `ALBAS_SYNC_ADMIN_TOKEN` rather than an account.

A **read-only viewer of a signed-in account's own synced calendar/todo data** (browsing your
events and to-dos from a browser) is still on the roadmap but is a separate, later piece of
work — not part of this build. The public site today stops at "signed in, here's your
session, log out." Don't build a data-fetching dashboard here without checking that plan is
still current.

## Key Constraints

- **Same origin as the sync server.** No CORS layer, and the WebAuthn RP ID is this exact
  domain — not a subdomain or the apex. See root `CLAUDE.md`, "Domain and origins".
- **Token handling:** the public site's session token (minted on passkey/password login)
  lives in `localStorage['albas-session']`. The admin console's token is a *different*
  credential (`ALBAS_SYNC_ADMIN_TOKEN`, entered once) in `localStorage['albas-admin-token']`.
  Never mix the two — an admin token is not an account session and vice versa.
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
│   │                           #   "/admin*" to admin.html
│   ├── index.html             # public site HTML shell -> frontend.tsx
│   ├── frontend.tsx           # public site React root -> App.tsx
│   ├── App.tsx                # splash / login / register / offline / signed-in router
│   ├── admin.html             # admin console HTML shell -> admin-frontend.tsx
│   ├── admin-frontend.tsx     # admin console React root -> AdminConsole.tsx
│   ├── AdminConsole.tsx       # admin console — accounts, shares, sync rows
│   ├── admin.css              # admin console styling (ported from the .dc.html design)
│   ├── index.css              # public site styling (ported from the .dc.html design)
│   ├── components/
│   │   ├── auth/               # Splash, PasskeyLogin, PasswordLogin, RegisterForm, OfflineInfo, SignedIn
│   │   └── ui/                  # shadcn primitives (Card, Button, Input, ...) — not used by
│   │                            #   the auth screens or admin console, which match their
│   │                            #   design references with plain CSS instead; left in place
│   │                            #   for anything that later wants a generic form control.
│   ├── lib/
│   │   ├── webauthn.ts         # base64url <-> ArrayBuffer, and the create()/get() ceremony wrappers
│   │   ├── api.ts              # fetch wrapper for the public-site endpoints (register/login/password/totp)
│   │   └── adminApi.ts         # fetch wrapper for /accounts, /admin/shares, /admin/rows — attaches
│   │                           #   the admin bearer token, throws AdminAuthError on 401/403
│   └── types/
│       └── admin.ts            # types mirroring sync-server's admin JSON shapes
├── build.ts                    # bun build -> dist/, both HTML entrypoints
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
- HTML imports work natively (`index.ts` imports `./index.html` and `../admin.html` directly)
  — no bundler config needed beyond `bun-plugin-tailwind` for Tailwind v4.

## The public site: auth flows

All three credential types are already implemented server-side (`sync-server/src/passkey.rs`,
`password.rs`, `totp.rs`) — this app is a client for them, not a place to invent new auth
logic. Endpoints below are called as `/api/...`; nginx strips the `/api` prefix before it
reaches `sync-server`, so `main.rs`'s routes are unprefixed.

- **Passkey register**: `POST /api/register/start {name, invite?}` → `{regId, options}`
  (`options` is a WebAuthn `CredentialCreationOptions`-shaped JSON, base64url-encoded per
  `webauthn-rs`'s JSON convention — decode with `lib/webauthn.ts` before passing to
  `navigator.credentials.create()`). Then `POST /api/register/finish {regId, label?,
  credential}` → `{name, token}`. Store the token, done.
- **Passkey login**: `POST /api/login/start` (no body) → `{authId, options}`. Then
  `POST /api/login/finish {authId, label?, credential}` → `{name, token}`.
- **Password login**: `POST /api/login/password {name, password, code?}` → `{name, token}`.
  A 401 whose body is exactly `"A two-factor code is required."` means: show a TOTP code
  field and retry with `code` set. That string is load-bearing (`totp.rs`'s `CODE_REQUIRED`)
  — match it exactly, don't pattern-match loosely on "401 means bad password."
- **Session**: once signed in, `localStorage['albas-session'] = {name, token}`. The signed-in
  view shows the account name and a Log Out button (clears the key); it does not need to
  re-validate the token against the server on load — an expired/revoked token just fails the
  next authenticated call, which is rare here since this page makes none after login.

Registration's `Invite Code` field from the original design mock is **intentionally not
built** — see root `CLAUDE.md`, "Project direction" ("Moving away from invites"). Signup is
open by default; don't add the field back without checking that note first.

## The admin console

Gated by `ALBAS_SYNC_ADMIN_TOKEN`, entered once and kept in
`localStorage['albas-admin-token']`, sent as `Authorization: Bearer <token>` on every call.
A 401/403 from any admin call should drop back to the token-entry screen — the token was
either never set or was wrong/rotated, and the console cannot tell those apart (`sync-server`
deliberately doesn't either — see `admin_ok` in `main.rs`).

Endpoints (all admin-gated, documented in full in `sync-server/README.md`):

```
GET    /api/accounts                            -> [{id, name, createdAt, grantRev, tokens: [...], passkeys: [...], rowCount,
                                                     hasPassword, totpEnabled, googleEmail}, ...]
POST   /api/accounts            {name}          -> {name, token}   (token shown once)
PATCH  /api/accounts/<name>     {name}          -> {name}   (rename; 409 conflict/owner, 422 invalid)
DELETE /api/accounts/<name>
PATCH  /api/accounts/<name>/passkeys/<id>        body {label} — empty clears to the derived name
DELETE /api/accounts/<name>/passkeys/<id>        409 if last passkey and no password/Google link
DELETE /api/accounts/<name>/tokens/<id>          revoke one session token
DELETE /api/accounts/<name>/password             idempotent; 409 if it's the only credential
DELETE /api/accounts/<name>/totp                 idempotent, never guarded
GET    /api/admin/shares                        -> [{ownerId, granteeId, ownerName, granteeName, calendar, todos}, ...]
PUT    /api/admin/shares/<owner>/<grantee>       body {calendar, todos}
DELETE /api/admin/shares/<owner>/<grantee>
GET    /api/admin/rows?account=&table=&limit=    -> [{accountId, accountName, tbl, pk, updatedAt, deleted, seq}, ...]
```

Note the path split: account CRUD stays at `/accounts` (unchanged from before this admin
build; nothing else calls it), and the credential-management routes are sub-resources of it —
they name their account in the path, so they don't collide with anything token-scoped. Sharing
and rows are under `/admin/` because the account-scoped `/shares` trio (used by the *app's*
own Settings → Sharing, not this console) resolves its owner from the bearer token — which an
admin token doesn't name. Two different identity models, two different route trees.

The 409s above are the server's lockout guards: nothing can mint a token for an *existing*
account, so an account stripped of its last credential would be permanently bricked. The
console maps each 409 to action-specific copy (see `ConfirmActionState.conflict` in
`AdminConsole.tsx`); "add passkey" is deliberately absent — a WebAuthn credential binds to
whichever authenticator runs the ceremony, so the account holder adds their own via
`/register` or the self-service `/passkeys/*` pair.

**There is no Invites panel and no `/admin/invites` endpoint.** See root `CLAUDE.md`,
"Project direction" — the product is moving to open-signup-only, so invite listing/revocation
isn't getting built out here. Don't add the panel back without revisiting that note.

**The bottom console box is not a real query engine.** `sync-server` exposes no SQL endpoint
(the schema note in the design and in the panel says so verbatim — keep it accurate). It
filters the rows already fetched from `/admin/rows` client-side with a couple of regexes,
exactly as `AdminConsole.tsx` does today. Don't wire it to a real backend query path.

## Theming

The public site and admin console each ship as a **single, deliberately un-themed** design —
flat white/purple for the public site, flat white/JetBrains-Mono-terminal for the admin
console — matching their `.dc.html` design references exactly rather than the main app's
`--t-*` light/dark token system. That system is Tauri-app-specific (see root `CLAUDE.md`,
"Theming"); this app doesn't import it and doesn't need to. If dark mode is wanted here later,
that's a new design decision, not a token swap — don't invent one unasked.

Fonts (`Outfit`, `Sora`, and `JetBrains Mono` for the admin console) load from Google Fonts via
a `<link>` in `index.html`/`admin.html`. That's fine here — unlike the offline-first Android
app (which self-hosts fonts specifically to avoid a network dependency on first paint, see
root `CLAUDE.md` "Typography"), this is a server-hosted web app that requires a network
connection to exist at all.

## What NOT to Do

- ❌ **Don't add an Invites panel or invite-code field.** See "Project direction" above.
- ❌ **Don't add a username field to passkey login.** It's discoverable/usernameless by design.
- ❌ **Don't build a real SQL endpoint for the admin console's query box.** It stays a
  client-side filter over already-fetched rows.
- ❌ **Don't mix the admin token and an account session token.** Different credentials,
  different `localStorage` keys, different failure handling.
- ❌ **Don't use express, Next.js, or any full-stack framework.** `Bun.serve()` is the server.
- ❌ **Don't parse a row's `payload` in the admin console.** It's never returned by
  `/admin/rows` in the first place — the endpoint only ever hands back bookkeeping columns.

## Deployment

Deployed by the same CI pipeline that publishes `sync-server/`; nginx forwards `/` and
`/admin` to the Bun app (see `sync-server/nginx/`) and strips `/api` before proxying to
`sync-server` itself. Both apps share one TLS-terminating reverse proxy.

## Testing

```bash
bun test            # unit tests in .test.ts files, if/when added
```

For a live end-to-end check against a real `sync-server`, run one locally
(`cd sync-server && cargo run`, with `ALBAS_SYNC_ADMIN_TOKEN` and either `ALBAS_SYNC_TOKEN` or
`ALBAS_SYNC_ORIGIN` set so it has a way to end up with an account — default address
`127.0.0.1:8787`) and `bun run dev` here. `src/index.ts` proxies `/api/*` to
`ALBAS_SYNC_INTERNAL_URL` (default `http://127.0.0.1:8787`) itself in dev, stripping the
`/api` prefix the same way nginx does in production — no local nginx needed. In production
that route never runs; nginx gets there first.

## Maintenance & Protocol Updates

When `sync-server/src/main.rs` or `passkey.rs`/`password.rs`/`totp.rs` change:
1. A new/changed field on an existing response → update the matching type in
   `src/types/admin.ts` (admin console) or the inline shape in `lib/api.ts` (public site).
2. A new admin route → add it to `lib/adminApi.ts` and to the endpoint table above.
3. A new synced table → the admin console's account/table filter dropdowns
   (`AdminConsole.tsx`) list tables by name for the Sync Data panel's filter; add it there too.

`sync-server` is the source of truth for the wire protocol; this app is a client and adapts
when it changes, never the other way around.
