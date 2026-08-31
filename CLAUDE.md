# CLAUDE.md

Albas is a Tauri v2 desktop **and Android** app — an all-in-one to-do list, calendar, and habit tracker. It is local-first: SQLite on the device is the source of truth and fully usable offline. Frontend: React + TypeScript + Tailwind CSS v4 (custom calendar grid). Backend: Rust via Tauri.

## Commands

The package manager is **bun** (`bun.lock`; there is no `package-lock.json`). Note that
`src-tauri/tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand` also name bun — if they
ever say `npm`, a Tauri build silently uses a different resolver than `bun install` did.

```bash
bun install

# Run in development — the Hyprland/Wayland WebKit workarounds
# (WEBKIT_DISABLE_DMABUF_RENDERER etc.) are baked into the "tauri" script
bun run tauri dev

# Android (SDK lives in ~/Android/Sdk; env vars set in ~/.bashrc)
bun run tauri android dev     # run on connected device/emulator
bun run tauri android build   # build APK

# A standalone APK — one that runs with the computer switched off.
# `android dev` installs a build whose webview loads the UI from the Vite dev
# server over the LAN, so that install is useless away from the desk. `build`
# compiles frontendDist into the binary instead; --debug signs it with the
# Android debug key so it will actually install.
bun run tauri android build -- --debug --apk --target aarch64
# Both commands write app-*-debug.apk to the same path, so check which one you
# have before installing (a LAN address here means it's the dev artifact):
unzip -p src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk \
  assets/tauri.conf.json | grep -o '"devUrl":"[^"]*"'

# Signed release build (see "Android signing" below), installed on the device.
# `tauri android build` only compiles — unlike `android dev` it has no install
# step — so the script chains adb itself. Same key + applicationId, so it is an
# in-place upgrade and the app's database survives.
bun run app:android      # build + adb install -r
bun run android:install  # re-install the last build, no recompile
bun run android:launch   # start it (release id is unsuffixed)

# Build for production
bun run build          # frontend ONLY (tsc + vite) — does not touch the desktop binary
bun run app:desktop    # = tauri build; produces src-tauri/target/release/albas + deb/rpm/AppImage

# Frontend dev server only (no Tauri, no SQLite, no sync — localStorage blob)
bun run dev

# Versions (see "Versioning" below)
bun run version:set 1.9.0
bun run version:check
```

**Critical:** `bun run build` is frontend-only; `bun run app:desktop` compiles the Tauri binary. Confusing them is why rebuilds appear to do nothing.

## Android signing & versioning
- App id + signing cert = identity. Same id with a different key → refuse install; only uninstall clears it (deletes database).
- **Debug suffix**: `applicationIdSuffix = ".dev"` installs as separate app `dev.daniel_p.albas.dev` with its own database.
- **Tauri quirk**: `tauri android dev` installs suffixed but launches unsuffixed — manually launch `adb shell am start -n dev.daniel_p.albas.dev/dev.daniel_p.albas.MainActivity` or tap "albas dev".
- **Release signing**: reads `gen/android/keystore.properties` (gitignored; see `.example`). Unsigned is OK if missing.
- **`tauri.properties`**: must live in `gen/android/app/` (module-relative path), not `gen/android/`.

## Versioning
**`package.json` is the single source of truth.** `bun run version:set <x.y.z>` rewrites all version files and tags. Never hand-edit `tauri.properties` (versionCode is Android-monotonic). Never blanket `cargo update` — `Cargo.lock` pins `webauthn-authenticator-rs` at 0.5.1; the script updates by name. `sync-server/` versions independently (0.2.0). App version injected as `__APP_VERSION__` from `package.json` (see `vite.config.ts`).

## Websites
- **`web/`**: Public site (`albas.danni-dev.com`), splash/login/register/offline-info, passkey + password+TOTP auth. See `web/CLAUDE.md`.
- **Admin console**: Staff-only at `/admin`, restricted by `ALBAS_SYNC_ADMIN_TOKEN` in `localStorage`. Lives in `web/` with its own `package.json` + `tsconfig.json` (root `tsconfig.json` excludes it). Wired to real `sync-server` endpoints. Design: `designs/Albas Admin Console.dc.html`.

## Domain and origins
- **One origin**: `albas.danni-dev.com` (subdomain, not apex). WebAuthn RP ID is a security boundary.
- **Changing domain invalidates all passkeys** — no migration, accounts re-created.
- **Three files move together**: `src/syncServer.ts` (no `/sync`), `src-tauri/src/sync.rs` `DEFAULT_URL` (with `/sync`), Android `asset_statements` in `values/strings.xml` (domain root).
- **`ALBAS_SYNC_ANDROID_ORIGIN`** is domain-independent (apk-key-hash); don't touch when moving domain.
- **nginx** strips `/api` prefix via trailing slash in `proxy_pass` (slashless breaks everything). Configs: `sync-server/nginx/`.
- **`__sync_url` beats `DEFAULT_URL`**: stored URL always wins, so add old URL to `SUPERSEDED_URLS` before moving default or old installs keep syncing to old host.
- **No user-editable server**: Server field removed from UI. Repoint a build by editing constants, not restoring a field.
- **`tauri.conf.json`**: strict JSON (no comments) — `//` causes "key must be a string" error.

## Project direction (settled decisions)
- **Local-only is free; sync is paid.** Offline must work fully. Accounts/registration free for now (`ALBAS_SYNC_SIGNUPS` defaults open). No subscription yet; don't add entitlement checks.
- **Plaintext payloads** (for now). E2E breaks admin viewer and read-only sharing. Intermediate step: encryption at rest, server-held key.
- **Invites moving away** (2026-08). Signup is open (anyone can create account). `POST /invites` kept only for bootstrapping existing accounts and `ALBAS_SYNC_SIGNUPS=invite` deployments. No further build-out (no list/revoke, no admin panel).
- **Not AWS.** Bottlenecks: no backups, unbounded tombstones, in-memory ceremony map (blocks replicas), single `Mutex<Connection>`. Path: current VM → home box. Image already multi-arch ARM.

## TODO LIST
1. To-do reminders only fire on the due day; consider firing at the to-do's `time` when one is set.
2. `WeightPanel.tsx` still uses the pre-redesign token aliases, so the Weight route looks a
   generation older than the four beside it. Cosmetic, not broken.
3. Settings' display name is read-only: `useApp()` exposes no generic settings *reader*, so a
   `setSetting('displayName', …)` could be written and never read back. An editable field
   needs a settings accessor on `AppContext` first.
4. `AddModal`'s create path offers a fixed five categories while the data model treats
   `category` as free text derived from use. You can pick an existing one but not make a new
   one there — only the edit path (`TodoForm`) can.
5. `CalendarEvent` has no `location` field. The Add modal's "Where" folds into the
   description as a leading `Location:` line rather than inventing a schema column, which
   would mean touching the schema, `sync.rs` `TABLES` and `sharedLogic.ts` together.
6. The `habits` route is unpersisted because `ActiveView` has no name for it, so a restart
   from Habits lands on the dashboard.

## Typography & icons
- **Fonts**: Outfit (body), Sora (headings), self-hosted from `public/Outfit/` + `public/Sora/`. `--t-font-body` / `--t-font-heading`. Nothing from fonts.googleapis.com.
- **Font rule**: `* { font-family: var(--t-font-body) }` must be in `@layer base` (unlayered outranks everything).
- **Icon**: `public/icon.svg` is favicon, platform icons, app mark. `bun run tauri icon public/icon.svg` rewrites `src-tauri/icons/` and Android launchers. Sidebar logo inline in `AppShell.tsx`.
- **lucide-react**: All icons in app are lucide components (tree-shaken SVG). Stroke-only. Size via `size={n}` prop, not `fontSize`.


## Data model & forms
- **To-dos**: `category` (free text), `important` flag. Categories derived from use (no managed list). Completed is a section (keeps category, sorts to bottom).
- **Schema v4**: adds `category`/`important` to habits. `sync.rs` TABLES must be updated for sync.
- **Month grid**: desktop sizes itself (flex-none, capped width). `RightPanel` absorbs surplus (flex-1).
- **Event form**: 3 rows (all-day, start, end). All-day drops time. New defaults: today, current quarter-hour, +1h. Start-date drag moves end-date.
- **Reminders**: editable list with presets + custom lead time.

## Data types
- **Todo**: tasks/habits/chores distinguished by `schedule` (Repeat). `once`=task, fixed cadence=habit, `fromDone: true`=chore. Stored in `habits` table.
- **CalendarEvent**: anything on calendar. Period = long all-day event (≥7 days as lanes).
- **WeightEntry**: scale reading. Always kg; `weightUnit` is display. Wyze uses upstream `data_id` for idempotent re-sync.
- **Colors**: hex strings from palette + color-wheel input. Legacy names resolve via `colorHex()`.

## Theming
- **Two themes**: `light` (default), `dark`. `data-theme` on `<html>`. SQLite (`meta`) is source of truth; `localStorage` used for pre-mount paint.
- **~74 `--t-*` custom properties** in `App.css`. Never hardcode hex (except user data like `PALETTE`/`CATEGORIES` in `AddModal.tsx`). Utilities emit `var(--t-…)` and runtime swap repaints.
- **Load-bearing**: `--t-grid-line`, `--t-past-x`, `--t-past-cell`/`-ink` restated in dark block (literal values). `--t-cat-*` ramps preserve hue. Radius is 0 everywhere (unlayered reset).
- **`color-scheme`**: set per theme (light on `:root`, dark in dark block). Keeps native date/time pickers legible.

## UI primitives (shadcn/ui + Radix)
- **Behavior-driven**: focus trap, Escape, scroll lock, `aria-*`, typeahead. Theming via `@theme inline` block maps shadcn colors to `--t-*` variables.
- **Rules for generated components**: Keep lucide imports. No literal colors (use `bg-scrim`). Watch spacing scale (`--spacing-sm: 12px`, `--spacing-lg: 40px`; shadcn sizes are broken). Don't import shadcn `Button` (use `forms/shared.tsx`).
- **`forms/shared.tsx`**: façade for `Select`, `CheckboxRow`, `SegmentedControl`, `inputClass`. Keeps old signatures while internals are Radix.
- **False friend**: `accent` in shadcn = hover surface, not brand color. Brand color is `--t-accent` (exposed as `primary`).

## Responsive & mobile
- **Breakpoint**: 767px (`useIsMobile()`, `matchMedia`). Test mobile layout by narrowing desktop window.
- **Under 768px**: sidebar/bottom-bar hidden. `HomeView` provides chrome on dashboard; other routes get shell's `.mobile-route-bar`. No `RightPanel`. Tap calendar tile → Day view (not add modal).
- **Month grid**: split by layout (4 files: `monthModel.ts`, `monthParts.tsx`, `MonthViewDesktop/Mobile.tsx`, `MonthView.tsx` shell). All logic in `monthModel.ts`; fixes there prevent one-layout-only bugs.
- **Phone grid**: always 6 rows (fixed). No due dots (redundant with habit list). Swipe-animated (`useMonthSlide`).
- **No "today" marker**: cells struck through with `PastX` instead (uses `--t-past-x`, stays visible in dark themes).

## Navigation & routing
- **Single list surface**: `TodoPanel` is the only to-do list (used in panel + full view). No Agenda panel.
- **`RightPanel` mounts for calendar route only** (not Settings/Weight). `TodoPanel` takes `habits` prop (on/off per surface). Habits never *done*, so redundant in to-do list.
- **Title**: `calendarTitle()` in `src/dates.ts`. Month/week omit year in current year. Don't add `<h2>` in `Calendar` (would render twice).
- **Navigation**: `calendar/CalendarNav.tsx` owns stepping for all modes (month/week/day). Desktop: row above sheet. Mobile: mode switch is `Dialog` with Today inside (only way back).
- **Mobile drops prev/next in month** (swipeable). Week/day keep them (not swipeable).

## Shell & layout
- **`AppShell.tsx`**: owns desktop chrome (sidebar, bottom bar). `Sidebar.tsx`, `TopBar.tsx`, `StatusBar.tsx` deleted.
- **Routing**: `Route` union (`dashboard | todo | habits | weight | settings`). `habits` deliberately unpersisted (restarts to dashboard).
- **Weight**: fifth sidebar item (design deviation; `WeightPanel` uses old token aliases).
- **`SidebarSlot`**: portals page-specific section (e.g., To-Do categories). State-held, not ref.
- **Bottom bar** (`BottomBar`): version left, sync/account right. Full width, every route.
- **Mobile nav trap**: Under 768px, `.sidebar`/`.bottom-bar` hidden; `HomeView` provides chrome on dashboard only. Other routes get `.mobile-route-bar` (back bar) from shell.

## Week start & layout gotchas
- **`firstDayOfWeek`**: threaded explicitly (no global). Defaults to 1 (Monday). Passed to `weekOf()`, `getCalendarDays()`, `isDueOn`, `doneCountIn`, `streakOf`, `statusLabel`, `repeatLabel`, `weeklyRows`, `calendarTitle`, `remindDueTodos`.
- **Weekday tables**: Sunday-first (matching `getDay()`), rotated with `rotateWeek()`. `weekdayAt(i, firstDay)` maps column → real weekday.
- **Weekend styling**: use `getDay()`, not column index.
- **`min-h-0` load-bearing**: on every `flex flex-col` ancestor of `HourGrid` (prevents hour body from dictating height and breaking `overflow-y-auto`).

## Device sync
- **Client** (`sync.rs`): `TABLES` lists synced columns — **schema column + sync column must match** or silent no-sync. `table_specs_match_the_schema` catches typos, not omissions.
- **Server** (`sync-server/`, Axum): opaque `(account, table, pk) → payload` rows. Never parses data (no redeploy on schema change).
- **Accounts**: server-scoped, isolated row sets. Per-device tokens (SHA-256 stored). `ALBAS_SYNC_TOKEN` creates `owner` `env`-token. Two migrations on first start (pre-account DB, accounts-with-inline-token_hash).
- **Two clocks**: `updated_at` (device, last-write-wins), `seq` (server monotonic, resume point). Don't collapse; skewed clocks can't make other devices skip rows.
- **Conflict resolution**: per row, not field. Latest row wins wholesale.
- **Settings not synced**: `__` prefix marks local-only keys (wyze creds, urls, tokens, etc.). Syncs on launch + manual button. Pull from Rust → call `reloadFromStore()` (condition: `pulled > 0 || sharedChanged`).

## Passkeys & auth
- **In-app ceremonies** (not browser): `tauri-plugin-webauthn` drives platform authenticator. Linux: CTAP2 USB keys via `webauthn-authenticator-rs`. Android: Credential Manager. macOS/iOS unsupported.
- **Plugin pins `webauthn-authenticator-rs`/`-proto` at 0.5.1** in `Cargo.lock`. Blanket `cargo update` breaks build.
- **Android**: `minSdk = 28`. `asset_statements` in tracked `AndroidManifest.xml`. Digital Asset Links at `/.well-known/assetlinks.json`. Credential Manager asserts `android:apk-key-hash:…` origin (see `ALBAS_SYNC_ANDROID_ORIGIN`).
- **Login**: discoverable/usernameless (credential id finds account). `residentKey: 'required'` forced in `src/auth.ts` (webauthn only prefers it).
- **Registration**: open by default (`ALBAS_SYNC_SIGNUPS=invite` locks it). Invites only for bootstrapping existing accounts.
- **Sign-in**: mints token, resets sync watermarks + shared cache. `usePasskeyAuth.ts` is single flow-state hook. `run(adoptsSession)`: login marks welcome done + reloads Rust writes; adding passkey to existing session does neither. Linux keys ask PIN via `PinDialog`.

## Sign-in methods
- **Primary**: Passkeys. Others: password, TOTP (optional).
- **Registry** (`src/authMethods/`): `AuthMethod` with `id`, `order`, `load(ctx)`, optional `Action`. Fixed imports (`passkey`, `password`, `totp`); no editing shared files when adding methods.
- **Contract**: `load()` returns *real* credentials only (no aspirational rows). Unconfirmed TOTP doesn't appear.
- **Passkeys**: ceremonies via Tauri. Self-service `POST /passkeys/start` + `/finish`. Bearer token for identity. Excludes existing credentials. Mints token; add-passkey path deletes it (keeps session).
- **Password**: `fetch` (no Tauri). Argon2id into `accounts.password_hash` (not `token_hash`). Identical 401 for unknown/wrong. `DELETE` refuses 409 if only credential.
- **TOTP**: `fetch`. `totp-rs` server-side, QR client-side (`qrcode.react`). `totp_confirmed` only after code verify. Re-enroll while confirmed = 409. **Second factor for password only** (not passkey — already possession + verification). UI clarifies.
- **`accounts` schema**: add `ensure_column()` call in `init_db` (not just `SCHEMA` — fresh DBs get no columns, existing DBs get none).

## Read-only sharing
- **Scopes**: `calendar` (events + periods), `todos` (habits + completions + tasks). Weights unshareable (dropped by `sync.rs`).
- **`grantRev`**: invalidation channel. Grant changes bump grantee revision; server sends full snapshot on mismatch. Client wipes `shared_rows` first.
- **Cache**: `shared_rows` (schema v5), not `sync::TABLES`. `db::load_shared` → `sharedLogic.ts` mapping. **Synced column = 3 touches**: schema, `sync.rs` `TABLES`, `sharedLogic.ts` mapping.
- **Shared id namespace**: `${owner}:${pk}` (never collides). `sharedBy` flag on events (render sites key off this). Reminders stripped (no buzzes for others' events).
- **Read-only enforcement**: three calendar shells (`MonthView`, `WeekView`, `DayView`) guard `sharedBy` before opening modal. `TodoPanel` per-owner blocks.
- **Hiding share**: device-local (`__shared_hidden`, never synced). Stops drawing, doesn't revoke.

## Wyze scale
- **API**: community reverse-engineered (no public API). `src-tauri/src/wyze.rs`.
- **Login**: email + password + API Key/ID from developer-api-console.wyze.com (API key acts as 2FA).
- **Signature**: `signature2` header = HMAC-MD5(body/sorted-GET-params) keyed by `md5(access_token + salt)`. Sort order + byte-perfect body are load-bearing.
- **Tests**: `cargo test --lib` pins hashes against Python reference. Check first if sync breaks.
- **Credentials**: OS keyring (desktop), or SQLite `meta` (Android, sandboxed not encrypted).

## Architecture

The app has two distinct layers that communicate via Tauri's IPC bridge:

- **Frontend** (`src/`): React app rendered in a WebView. Entry point is `src/main.tsx`, which mounts `AppShell` inside `AppProvider` (`src/context/AppContext.tsx`) — the single source of truth for todos, events, weights, settings, selected date, and active view. Persistence goes through `src/persistence.ts`, which picks SQLite-via-Tauri or a whole-blob `localStorage` fallback (key `albas-data-v1`) for the browser dev server. UI components live in `src/components/`, shared date helpers in `src/dates.ts`, and Tailwind v4 design tokens in `src/App.css`.
- **Backend** (`src-tauri/src/`): Rust. `lib.rs` defines Tauri commands registered with `invoke_handler`; `main.rs` calls `run()`. To expose a new Rust function to the frontend, annotate it with `#[tauri::command]` and add it to `generate_handler![]` in `lib.rs`.

Frontend calls Rust via `invoke()` from `@tauri-apps/api`. Tauri capabilities (permissions) are configured in `src-tauri/capabilities/default.json`.
