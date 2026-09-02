# CLAUDE.md

Albas: Tauri v2 desktop + Android to-do/calendar/habit app. Local-first — SQLite on device is truth,
fully offline. React + TS + Tailwind v4 (`src/`); Rust backend (`src-tauri/src/`, commands in `lib.rs`
→ `generate_handler![]`). `AppContext.tsx` holds frontend state, `persistence.ts` picks SQLite or,
for `bun run dev`, a `localStorage` blob.
## Commands (package manager is **bun**)
- `bun run tauri dev` — desktop dev (Wayland WebKit workarounds baked into the `tauri` script).
  `bun run build` is **frontend only** (tsc+vite); `bun run app:desktop` builds the Tauri binary
  and installs it to `~/.local/bin/albas` (the launcher's `.desktop` Exec target — never point it
  into `target/`) — confusing these is why rebuilds appear to do nothing. `bun run clean` wipes
  the rebuildable cargo/Gradle caches (~27G) but keeps `release/` and `aarch64-linux-android`.
  Sync-server image: `sync-server/scripts/publish.sh` (local amd64 build → GHCR); the GitHub
  workflow is manual-only, for multi-arch.
- `bun run tauri android dev` installs a build that loads the UI from the LAN dev server (useless
  away from the desk); `tauri android build -- --debug --apk --target aarch64` embeds `frontendDist`.
  Both write the same APK path — check `devUrl` in the apk's `tauri.conf.json`. Release:
  `bun run app:android` (build + adb install -r), `android:install`, `android:launch`.
- `bun run version:set <x.y.z>` — `package.json` is the single version source; never hand-edit
  `tauri.properties` (versionCode is Android-monotonic). `sync-server/` versions separately.
## Gotchas that cost hours
- **App id + signing key = identity.** Debug builds get a `.dev` suffix + own DB; `tauri android dev`
  installs suffixed but launches unsuffixed. `tauri.properties` must live in `gen/android/app/`.
  `tauri.conf.json` is strict JSON — a `//` comment gives "key must be a string".
- **Synced column = 3 touches**: schema, `sync.rs` `TABLES`, `sharedLogic.ts`. Mismatch = silent
  no-sync. A new column on any shipped sync-server table (`accounts`, `passkeys`, …) needs an
  `ensure_column()` call in `init_db`, not just `SCHEMA`.
  `min-h-0` on every `flex flex-col` ancestor of `HourGrid` is load-bearing.
- `* { font-family: var(--t-font-body) }` must be in `@layer base`. Never hardcode hex — use the
  ~74 `--t-*` tokens in `App.css`; radius is 0 everywhere. shadcn's `accent` is a hover surface, not
  the brand color (`--t-accent`); use `forms/shared.tsx`, not shadcn `Button`. Icons are lucide.
## Domain & sync
- One origin `albas.danni-dev.com`; changing it invalidates all passkeys. `src/syncServer.ts` (no
  `/sync`) and `src-tauri/src/sync.rs` `DEFAULT_URL` (with `/sync`) move together.
- Stored `__sync_url` beats `DEFAULT_URL` — add the old URL to `SUPERSEDED_URLS` before moving. The
  user-editable server URL is in Settings; blank means default, never localhost. nginx strips `/api`
  via the trailing slash in `proxy_pass` (`sync-server/nginx/`).
- Server stores opaque `(account, table, pk) → payload`; it never parses data. Two clocks:
  `updated_at` (device, last-write-wins per whole row) and `seq` (server, resume point). Settings
  keys prefixed `__` are local-only and never synced.
- Sharing is read-only, scopes `calendar`/`todos` (not weights), cached in `shared_rows`, ids
  namespaced `${owner}:${pk}`; a `grantRev` bump forces a full snapshot.
## Auth (settled 2026-08)
- **All WebAuthn happens in the system browser** (`web/` — public site plus the `/admin` console);
  the app holds no WebAuthn code. Handoff is nonce + poll (`sync-server/src/app_session.rs`,
  `useBrowserSignIn.ts`) with a 4-char code — deliberately not an `albas://` deep link.
- Methods: passkeys (primary, discoverable), password (Argon2id), optional TOTP (second factor for
  password only). Registry `src/authMethods/`; `load()` returns real credentials only. Signups open;
  invites only bootstrap existing accounts, no further build-out.
- Google OAuth is a server-side confidential client (`google.rs`); its three env vars are all-or-
  nothing. **A name match never adopts an account** — that would hand over passkey accounts.
## Direction & TODO
Local-only free, sync paid — offline must stay complete. Payloads plaintext for now. Not AWS; known
limits: no backups, unbounded tombstones, in-memory ceremony map, single `Mutex<Connection>`.
1. To-do reminders fire on the due day, not at the to-do's `time`. `WeightPanel.tsx` still uses
   pre-redesign token aliases. The `habits` route is unpersisted (`ActiveView` has no name for it).
2. Settings' display name is read-only — `useApp()` has no generic settings reader.
3. `AddModal` create path offers five fixed categories, only `TodoForm` can make new ones; and
   `CalendarEvent` has no `location`, so the Add modal folds it into the description.
4. Push 2FA wanted but unbuilt (needs device registration, a push channel, pending state).
5. No way to add a passkey to an existing account (`/passkeys/start`/`/finish` live but uncalled);
   linking an existing account to Google likewise needs an authenticated Settings action.
