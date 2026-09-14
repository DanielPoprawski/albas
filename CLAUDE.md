# CLAUDE.md

Albas: Tauri v2 desktop + Android to-do/calendar/habit app. Local-first — SQLite on device is truth,
fully offline. React + TS + Tailwind v4 (`src/`); Rust (`src-tauri/src/`, commands in `lib.rs`);
`sync-server/` (axum row store, own README); `web/` (Bun sign-in site, own `web/CLAUDE.md`). `README.md`
has the module layout and known gaps. **Data is live and personal — every schema change ships with a
migration.** Client: `db.rs` `open()` steps `user_version`; add `if version < N { ALTER … }` for existing
DBs and keep `SCHEMA` at the current shape so a fresh DB skips it (new tables = `CREATE TABLE IF NOT
EXISTS`, replay-safe). Server: `ensure_column()` in `schema.rs` `init_db`. Never drop or rename a column
or table without a data-preserving path, and never leave old rows unreadable.

## Commands (package manager is **bun**)
- `bun run tauri dev` = desktop dev. `bun run build` is **frontend only**; `bun run app:desktop` builds
  the Tauri binary and installs it to `~/.local/bin/albas` (the launcher's Exec target — never point it
  into `target/`). Confusing these is why rebuilds appear to do nothing. `bun run clean` wipes caches.
- `bun run app:android` is the **only** Android command: signed release, build + install + launch.
  `tauri android dev` and the debug/`.dev` build are deliberately off the menu (separate app id =
  separate DB = always signed out); `--debug --apk` by hand only for WebView devtools.
- `bun run version:set <x.y.z>`: `package.json` is the single version source; never hand-edit
  `tauri.properties` (versionCode is Android-monotonic).
- Gate before pushing (CI runs the same): `bun run lint && bun run audit:css && bun run knip &&
  bun run build && (cd src-tauri && cargo check --message-format=short && cargo test -q)`. Lint is Biome
  with the formatter on (2-space, single quotes, 120 cols). Server image: `sync-server/scripts/publish.sh`.
- **App id + signing key = identity.** `tauri.properties` must live in `gen/android/app/`.
  `tauri.conf.json` is strict JSON — a `//` comment gives "key must be a string"; its `security.csp` is
  set, read it before adding an asset source. `compileSdk = 36` (targetSdk 34) and AGP 8.7.3 in both
  `build.gradle.kts` files are load-bearing for the barcode scanner's CameraX. Don't "tidy" them.

## Data & sync invariants
- **Synced column = 4 touches**: `db.rs` (`SCHEMA` + `user_version` migration), `src-tauri/src/sync.rs`
  `TABLES`, `sharedLogic.ts` (+ `persistence.ts` both branches and `src/ipc.ts`). Mismatch = silent no-sync. `todos.category` /
  `events.category` hold a category **id** ('' = none). A new column on a shipped sync-server table
  needs an `ensure_column()` call in `schema.rs` `init_db`, not just `SCHEMA`.
- Server stores opaque `(account, table, pk) → payload`, never parses it. Two clocks: `updated_at`
  (device, last-write-wins per row) and `seq` (server, resume point). `__`-prefixed settings are local
  only. Sharing is read-only (`calendar`/`todos`), cached in `shared_rows`, ids `${owner}:${pk}`;
  a `grantRev` bump forces a full snapshot.
- One origin `albas.danni-dev.com`; changing it invalidates all passkeys. `src/syncServer.ts` (no
  `/sync`) and `sync.rs` `DEFAULT_URL` (with `/sync`) move together; add the old URL to `db.rs`
  `SUPERSEDED_URLS` first, since a stored `__sync_url` beats the default. Blank Settings URL = default,
  never localhost. nginx strips `/api` via the trailing slash in `proxy_pass`.
- **All Tauri IPC goes through `src/ipc.ts`**; never call `invoke` elsewhere. Web portal HTTP goes
  through `web/src/lib/api.ts` `request()`. Auth validation constants live in `shared/authRules.ts`.

## Auth invariants
- Username + password is the mandatory first credential and runs in-app (`PasswordForm` →
  `usePasswordSignIn` → Rust `account_*_password` → `adopt_session`). Passkeys and TOTP come after.
- **The WebView never fetches the server** — no CORS layer exists; WebKit reports the blocked preflight
  as `TypeError: Load failed`. Every `src/authMethods/*` call goes through `apiRequest()` → Rust `sync_api`.
- **All WebAuthn happens in the system browser** (`web/`); the app holds none. It is the secondary path:
  nonce + poll handoff (`app_session.rs`, `useBrowserSignIn`) with a 4-char code, not a deep link. The
  nonce rides in the URL **fragment** (`#app_session=`/`#linked=`) so it never hits an access log.
  Cross-device QR reuses `app_sessions`; the scanner plugin is Android only.
- Google OAuth is server-side (`google.rs`); env vars all-or-nothing. **A name match never adopts an
  account.** The `state` cookie must match the query param before the pending map is read.
- Bearer tokens: 90-day sliding idle expiry; desktop keeps it in the OS keyring (`token_store.rs`),
  mobile in SQLite — read via `token_store::get`. `__sync_token` is only a `"1"`/`""` presence marker.
- TOTP secrets are AES-256-GCM under `ALBAS_SYNC_KEK` (unset = enroll 503s); codes single-use per
  step; ten failures lock the credential 15 min (`423`), distinct from rate limiting (`429`).

## Frontend rules
- State: `src/context/{Settings,Ui,Data}Context.tsx` behind `useApp()` (merged) or the narrow
  `useSettings/useUi/useData`; `appearance.ts` stamps theme/font/layout as inline vars on `<html>`,
  mirrored to `localStorage` for `index.html`'s pre-paint. `persistence.ts` = SQLite, or a
  `localStorage` blob under `bun run dev`.
- Never hardcode hex — use the `--t-*` tokens in `App.css` (`:root` + a full `[data-theme='dark']`
  restatement; `@theme inline` re-exports them as `bg-accent`/`text-ink`/`border-line`/…). Text on the
  accent is `text-on-accent`, never `text-white`. `src/colors.ts` mirrors the light hexes as **data
  identities** only. `bun run audit:css` enforces: mirror matches `:root`, no `#hex` in TSX, no dead
  App.css class, every utility resolves to a `@theme` key (an unknown one compiles to *nothing*), no
  `@media (max-width…)` in App.css (phone layout is `max-md:`, 768px = `useMedia.ts`), and inline
  `style={}` only for runtime data with a `// dynamic:` comment within the 3 lines above.
- App.css order: tokens → `@theme` → `@utility`s → `@layer base` (`* { font-family }` must be here) →
  unlayered resets → `@layer components` (multi-file classes only) → keyframes. Component classes lose
  to utilities on the same element. Reuse `components/ui/` (no barrel) and `forms/shared.tsx` before
  inlining; recipes are `@utility` blocks (`micro-label`, `panel`, `icon-btn`, `field-input`, `chip`, …).
- **rem, not px**: Settings › Text size scales `html` font-size, so lucide icons take `size="1rem"`,
  calendar geometry is `@theme` `--spacing-hour-h/gutter-w/lane-h/lane-row`, text sizes are Tailwind's
  `text-xs`…`text-lg` or `text-micro/meta/ui/h1`. px only for 1–2px hairlines. Radius 0, no focus
  outlines, by design. `min-h-0` on every `flex flex-col` ancestor of `HourGrid`.
- Creating things goes through `createItem.ts` `buildCreate()` (`QuickAddField`, calendar clicks, Ctrl+N).
  **Leaving a modal saves it**: `useModalDismiss` routes Escape/scrim/×/Android back to `commit()`; only
  Cancel discards. `nlDate.ts` = casual chrono in titles, strict day-first in `DateField`. Shortcuts +
  their Settings list = `shortcuts.ts` `SHORTCUTS`.
