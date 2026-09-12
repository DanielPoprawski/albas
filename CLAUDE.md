# CLAUDE.md

Albas: Tauri v2 desktop + Android to-do/calendar/habit app. Local-first — SQLite on device is truth,
fully offline. React + TS + Tailwind v4 (`src/`); Rust backend (`src-tauri/src/`, commands in `lib.rs`
→ `generate_handler![]`). `src/context/` holds frontend state (Data/Ui/Settings providers behind `useApp()`; `appearance.ts` stamps theme/font/layout), `persistence.ts` picks SQLite or,
for `bun run dev`, a `localStorage` blob.
## Commands (package manager is **bun**)
- `bun run tauri dev` — desktop dev (Wayland WebKit workarounds baked into the `tauri` script).
  `bun run build` is **frontend only** (tsc+vite); `bun run app:desktop` (`tauri build --no-bundle`
  — Arch box, the deb/rpm bundles were dead weight) builds the Tauri binary
  and installs it to `~/.local/bin/albas` (the launcher's `.desktop` Exec target — never point it
  into `target/`) — confusing these is why rebuilds appear to do nothing. `bun run clean` wipes
  the rebuildable cargo/Gradle caches (~27G) but keeps `release/` and `aarch64-linux-android`.
  Sync-server image: `sync-server/scripts/publish.sh` (local amd64 build → GHCR); the GitHub
  workflow is manual-only, for multi-arch.
- Android: `bun run app:android` is the **only** Android command — signed release, build +
  `adb install -r` + `adb shell am start` (it launches the app itself; there are deliberately no
  standalone launch scripts). It embeds `frontendDist`; `scripts/dev.sh` is the menu.
  `tauri android dev` (LAN dev server) is deliberately not on the menu. The debug/`.dev` build was
  dropped in favour of release-only Android development (its separate app id = separate DB = always
  signed out); the gradle `debug` build type still works by hand
  (`bun run tauri android build --debug --apk --target aarch64`) if you need WebView devtools.
- `bun run version:set <x.y.z>` — `package.json` is the single version source; never hand-edit
  `tauri.properties` (versionCode is Android-monotonic). `sync-server/` versions separately.
## Gotchas that cost hours
- **App id + signing key = identity.** Debug builds get a `.dev` suffix + own DB; `tauri android dev`
  installs suffixed but launches unsuffixed. `tauri.properties` must live in `gen/android/app/`.
  `tauri.conf.json` is strict JSON — a `//` comment gives "key must be a string".
  `gen/android/app/build.gradle.kts` `compileSdk = 36` (targetSdk 34) and AGP 8.7.3 (both
  `build.gradle.kts` files) are load-bearing: the barcode-scanner plugin's CameraX refuses
  compileSdk < 35 and AGP < 8.6. Don't "tidy" them back.
- **Synced column = 3 touches**: schema, `sync.rs` `TABLES`, `sharedLogic.ts` (+ `persistence.ts`
  both branches and `src/ipc.ts`). Mismatch = silent no-sync. `categories` is synced and in both
  share groups; `todos.category`/`events.category` hold a category **id** ('' = none). A new column on any shipped sync-server table (`accounts`, `passkeys`, …) needs an
  `ensure_column()` call in `init_db`, not just `SCHEMA`.
  `min-h-0` on every `flex flex-col` ancestor of `HourGrid` is load-bearing.
- `* { font-family: var(--t-font-body) }` must be in `@layer base`. Never hardcode hex — use the
  `--t-*` tokens in `App.css` (`:root` + a full `[data-theme='dark']` restatement; `@theme inline`
  re-exports them as `bg-accent`/`text-ink`/`border-line`/… utilities). Roles: page/surface/subtle
  (+strong), ink(-secondary/-muted), line(-strong/-subtle), accent(-hover/-deep/-tint),
  **on-accent** (text on the accent — never `text-white`), danger/success/warn/info (+tint/line),
  selection, scrim, icon-idle, shadow-card/-modal/-pop/-accent, cat-{purple,amber,green,blue,
  pink,red,teal}(-tint/-line/-ink). `src/colors.ts` mirrors the light hexes as **data identities**
  (stored `colorKey`s, `CATEGORY_CLASSES` keys) — never paint from them; `scripts/css-audit.mjs`
  (`bun run audit:css`, in CI) asserts the mirror matches `:root`, that no `#hex` sits in TSX, no
  App.css class is dead, and every `bg-*`/`text-*`/… utility resolves to a `@theme` key (an unknown
  one compiles to *nothing* — that is how the current-time line went invisible).
  App.css order: tokens → `@theme` → `@utility`s → `@layer base` → unlayered radius/QR reset →
  **`@layer components`** (only the multi-file classes: `.sidebar*`, `.setting-*`) → keyframes.
  Everything a single component uses is Tailwind utilities on that component; **phone layout is
  `max-md:`** (Tailwind `md` = 48rem = 768px = `useMedia.ts` `MOBILE_QUERY`) — the audit fails on
  any `@media (max-width…)` in App.css. Component classes lose to utilities on the same element,
  so write `setting-desc mt-0`, never a `style={}` patch. Recipes are `@utility` blocks:
  `micro-label`, `panel`, `icon-btn`, `field-input`, `row-hover`, `card-title`,
  `button-small/-primary/-danger`, `form-message`, `gradient-accent`, `scrollbar-hide`, `chip`
  (`data-selected`). Reuse `components/ui/` (import the file, there is no barrel: Card,
  Button/IconButton, Segmented (`fill`), Switch, Tag/Dot, MicroLabel, Input/Textarea/FormMessage,
  ModalChrome, SectionHeading) before inlining. **No static `style={{}}`** — inline is only for
  runtime data (a stored colour, computed geometry) and **must** carry a `// dynamic:` comment
  within the 3 lines above it (audit check (e); the Biome rule is off). Calendar geometry is rem
  via `@theme` `--spacing-hour-h/gutter-w/lane-h/lane-row` (`h-hour-h`, `w-gutter-w`), so
  Settings › Text size scales the grids too. No focus outlines anywhere by design (`App.css`
  `@layer base`); fields show focus via the accent border only. Radius is 0 everywhere. **rem, not
  px**: Settings › Appearance scales `html` font-size (up to 175%), so px chrome won't follow —
  lucide icons take `size="1rem"` strings, never numbers. Text sizes are Tailwind's `text-xs`
  (12px, the floor) / `text-sm` / `text-base` / `text-lg` or the `text-micro/meta/ui/h1` tokens,
  never `text-[Nrem]`. Keep px only for 1–2px hairlines. Appearance (accent/font/size) =
  inline vars on `<html>` via `applyAppearance()`, mirrored to `localStorage['albas-appearance']`
  for `index.html`'s pre-paint. shadcn's `accent` is a hover surface, not the brand color
  (`--t-accent`); use `forms/shared.tsx`, not shadcn `Button`. Icons are lucide.
- **All Tauri IPC goes through `src/ipc.ts`** (typed wrapper per `generate_handler![]` command);
  never call `invoke` elsewhere. Web portal HTTP goes through `web/src/lib/api.ts` `request()`.
  Auth validation constants live in `shared/authRules.ts` (both apps). `bun run lint` is Biome
  (signal-only lint config in `biome.json`; the **formatter is on** — 2-space, single quotes,
  120 cols — and CI runs `biome ci`, so format before pushing); `bun run knip` reports dead
  files/exports/deps (`knip.json`; unused exports are warnings); `.github/workflows/ci.yml` runs
  biome ci, audit:css, knip, both builds and `cargo test` on push. `web/` is plain CSS (`web/src/index.css`, its own
  `--*` tokens, no Tailwind, no inline styles); `web/tsconfig.json` has unused checks on.
- Layout widths (`--layout-sidebar-w`/`--layout-right-w`) are inline vars on `<html>` via
  `applyLayout()`, persisted as `__layout_*` and mirrored to `localStorage['albas-layout']`;
  `MonthViewDesktop`'s `RESERVED` sums them. Global shortcuts + the Settings list both come from
  `src/shortcuts.ts` `SHORTCUTS`; `/` reaches components via `registerFocusTarget` there.
  `SearchBar` (regex/highlight/bulk actions) is one per route. Creating things: `QuickAddField`
  (one line + Enter, on every list surface and the phone tabs; no floating "+"), calendar clicks
  (month cell → `AddModal` with the date, hour-grid slot → with the hour), Ctrl+N. Both go through
  `createItem.ts` `buildCreate()`. **Leaving a modal saves it**: `useModalDismiss` routes Escape,
  scrim, × and Android back (a pushed history entry) to the form's `commit()` (`CommitRef` in
  `forms/shared.tsx`); only Cancel discards. `nlDate.ts`: casual chrono in titles (ranges too —
  "sun to thu", "2-4pm"), strict day-first chrono in `DateField` (plain text, no picker;
  "18 sep" yes, "tomorrow" no). Dates: `dates.ts` over date-fns; recurrence expansion and ICS
  RRULE parsing over `rrule` (floating UTC dates, see `eventLogic.ts`).
## Domain & sync
- One origin `albas.danni-dev.com`; changing it invalidates all passkeys. `src/syncServer.ts` (no
  `/sync`) and `src-tauri/src/sync.rs` `DEFAULT_URL` (with `/sync`) move together.
- Stored `__sync_url` beats `DEFAULT_URL` — add the old URL to `SUPERSEDED_URLS` before moving. The
  user-editable server URL is in Settings; blank means default, never localhost. nginx strips `/api`
  via the trailing slash in `proxy_pass` (`sync-server/nginx/`).
- Server stores opaque `(account, table, pk) → payload`; it never parses data. Two clocks:
  `updated_at` (device, last-write-wins per whole row) and `seq` (server, resume point). Settings
  keys prefixed `__` are local-only and never synced.
- Sharing is read-only, scopes `calendar`/`todos`, cached in `shared_rows`, ids
  namespaced `${owner}:${pk}`; a `grantRev` bump forces a full snapshot.
## Auth (reworked 2026-09, hardened 2026-09 Phase E)
- **Username + password is the mandatory first credential** and runs in-app: `PasswordForm` →
  `usePasswordSignIn` → Rust `account_login_password` / `account_register_password` (ureq) →
  `adopt_session`. Server: `POST /register/password`, `POST /login/password` (428 = TOTP code
  needed, `code` or `recovery_code` in the body). Passkeys and TOTP are added *after*, never at
  signup. Passwords are 12–128 characters (`MIN`/`MAX_PASSWORD_LENGTH`, mirrored in
  `src/syncServer.ts` and `web/src/components/auth/RegisterForm.tsx`).
- **The WebView never fetches the server** — no CORS layer exists, and WebKit reports the blocked
  preflight as `TypeError: Load failed`. Every `src/authMethods/*` call goes through `apiRequest()`
  → Rust `sync_api`. Don't reintroduce `fetch` there.
- **All WebAuthn happens in the system browser** (`web/`); the app holds no WebAuthn code. It is
  the *secondary* path ("More sign-in options"): nonce + poll handoff (`app_session.rs`,
  `useBrowserSignIn` in `signInHooks.ts`) with a 4-char code — deliberately not an `albas://` deep link. Adding a
  passkey = sign in on the portal with the password, then "Add a passkey" (`/passkeys/start|finish`).
  Firefox on Linux can't do a discoverable passkey login (bare NotAllowedError) — that was the
  original "login doesn't work" bug. The nonce rides in the URL **fragment**
  (`#app_session=`/`#linked=`, not `?app_session=`) so it never reaches a server access log —
  `account.rs`/`google.rs` emit it, `web/src/App.tsx`'s `paramFromHashOrQuery` reads it (query
  fallback kept for one release, then drop it). `app_sessions` is capped at 1000 pending rows.
- **Cross-device QR** reuses `app_sessions`, no new routes: `claim` accepts any account token, so a
  signed-in phone approves a desktop (`app_session_claim`), and a signed-in device pre-claims a
  session for a phone to poll (`app_session_offer` → `#linked=` URL, `app_signin_attach`). The
  scanner is `tauri-plugin-barcode-scanner`, Android only (`capabilities/mobile.json`, cfg(mobile)).
- Registry `src/authMethods/`; `load()` returns real credentials only. Signups open; invites only
  bootstrap existing accounts, no further build-out.
- Google OAuth is a server-side confidential client (`google.rs`); its three env vars are all-or-
  nothing. **A name match never adopts an account** — that would hand over passkey accounts. `start`
  sets an `HttpOnly; Secure; SameSite=Lax` cookie (`Path=/api/auth/google`) carrying the OAuth
  `state` plus a PKCE verifier server-side; `callback` requires the cookie's state to match the
  query param before it even looks at the pending-flow map — this is what stops login-CSRF (an
  attacker harvesting their own valid `code`+`state` and handing the URL to a victim). Failures are
  a single generic message to the browser; detail is logged server-side only.
- **Sessions (bearer tokens)** have a 90-day sliding idle expiry (`tokens.expires_at`, touched at
  most hourly by `account_for`) — an active device never re-authenticates, an abandoned one
  eventually 401s on its own. `GET /tokens`, `DELETE /tokens/current` (what `sync_sign_out` calls
  best-effort before clearing local state), `DELETE /tokens/:id`, `DELETE /tokens` (all but
  current) are self-service, authenticated by the bearer token itself.
- **The sync token lives in the OS keyring on desktop** (`token_store.rs`, service `"albas"`, entry
  `"sync_token"`), SQLite settings on mobile (no keyring backend
  there). `sync.rs`/`account.rs` read it through `token_store::get`, never `db::read_setting`
  directly. The `__sync_token` settings row still exists but now holds a non-secret `"1"`/`""`
  marker — `SettingsContext.tsx`'s `signedIn = !!settings.__sync_token?.trim()` check reads only
  presence, so it needed no change; nothing should read that key expecting the real token.
- **TOTP** (`totp.rs`): the secret is AES-256-GCM-encrypted at rest under `ALBAS_SYNC_KEK` (32
  bytes, base64 in the env) — unset means enrollment 503s rather than storing plaintext, and an
  undecryptable row fails verification closed with a server-side log. A code (or recovery code) is
  single-use per 30-second step (`totp_used`), so sniffing one off the wire doesn't buy a second
  login. `POST /totp/enroll` now requires `{password}`, re-verified. Confirming enrollment returns
  eight one-time recovery codes (`xxxxx-xxxxx`, SHA-256 hashed) shown once; `login/password`
  accepts one via `recovery_code` in place of `code`. Ten wrong attempts (password *or* TOTP,
  tracked independently) locks that credential for 15 minutes (`lockout.rs`, `auth_failures` table)
  — `423`, distinct from rate limiting's `429` (`tower_governor` in `main.rs` + nginx
  `limit_req_zone` in `nginx/tls.conf`, both keyed on the real client IP via
  `X-Forwarded-For`/`X-Real-IP`).
- **Self-service account deletion/export**: `DELETE /account` `{password}`, `GET /account/export`
  (every non-deleted row as JSON) — wired into Settings › Account (`account_delete`,
  `account_export` writes to the app data dir; no dialog/fs plugin).
- Tauri: `devtools` config removed from `tauri.conf.json` (reverts to the built-in default — on for
  `#[cfg(debug_assertions)]`, off otherwise — rather than the old explicit `true`, which forced them
  on even in release builds). `security.csp` is no longer `null`; see the value in
  `tauri.conf.json` before loosening it for a new asset source.
## Direction & TODO
Local-only free, sync paid — offline must stay complete. Payloads plaintext for now (TOTP secrets
are the one exception — encrypted at rest, see Auth). Not AWS; known limits: backups are a Litestream sidecar to a local dir (`sync-server/litestream.yml`, no off-site replica yet), unbounded
tombstones, in-memory ceremony map (`passkey::Pending`/`google::Pending` — `app_sessions` itself is
now capped at 1000, see Auth), single `Mutex<Connection>`.
I have no problem with deleting any of the data on any of the accounts. I don't use it yet and I have all data backed up on google calendar and my other apps. Don't worry about migrations
1. To-do reminders fire on the due day, not at the to-do's `time`. The `habits` route is
   unpersisted (`ActiveView` has no name for it).
2. Settings' display name is read-only (`useApp().getSetting` exists now, the UI doesn't use it).
3. `CalendarEvent` has no `location`, so the Add modal folds it into the description. Categories
   seed only on a fresh, signed-out install (see `AppContext` seed rule).
4. Push 2FA wanted but unbuilt (needs device registration, a push channel, pending state).
5. Linking an existing account to Google needs an authenticated Settings action (passkeys are now
   added from the portal's signed-in page). Habits stats (`StatCard`/`WeekChart`) are commented
   out pending a rework.
