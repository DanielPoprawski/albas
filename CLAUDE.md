# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Albas is a Tauri v2 desktop **and Android** app — an all-in-one to-do list, calendar, and habit tracker, positioned as "the ultimate productivity suite: for managing your schedule, keeping track of chores and errands, and building your habits". It is local-first: SQLite on the device is the source of truth and the app is fully usable with no server at all. The frontend is React + TypeScript + Tailwind CSS v4 (custom calendar grid, no calendar library), built with Vite. The backend is Rust via Tauri.

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

**`bun run build` is not `bun run tauri build`.** The former is the frontend bundle; the
latter is the thing a `.desktop` entry actually launches. Confusing the two is why a rebuild
can appear to change nothing.

## Android identities, signing, and versioning (v1.6)
Android identifies an installed app by **applicationId + signing certificate**. Same id signed by a different key is not an upgrade — the install is refused, and the only way through is an uninstall, which deletes the app-private SQLite database. That one rule explains everything below.

**Debug builds carry an `applicationIdSuffix = ".dev"`** (`app/build.gradle.kts`), so they install as `dev.daniel_p.albas.dev` — a second app, its own launcher entry ("albas dev", overridden in `app/src/debug/res/values/strings.xml`, a debug source set because `resValue` would collide with `main`), and its own database. Without the suffix, every switch between a dev build and the real app cost a wipe.

**Known Tauri quirk:** `tauri android dev` installs the suffixed app but launches the *unsuffixed* one — it derives the activity from `identifier` in `tauri.conf.json` and doesn't know about the gradle suffix. You get `Starting: Intent { cmp=dev.daniel_p.albas/.MainActivity }` and either the wrong app comes forward or nothing happens. Tap "albas dev", or launch it explicitly — note the component: the applicationId is suffixed, the *class* package is not, because `applicationIdSuffix` doesn't move `namespace`.
```bash
adb shell am start -n dev.daniel_p.albas.dev/dev.daniel_p.albas.MainActivity
```
Hot reload works normally after that; the dev build still points at the LAN dev server.

**Release signing** reads `gen/android/keystore.properties` (gitignored; see `keystore.properties.example`). The config is optional by design — without it the release build stays unsigned rather than failing. Verify a signed APK with `$ANDROID_HOME/build-tools/34.0.0/apksigner verify --print-certs` (build-tools is not on PATH); it should show `CN=Daniel Poprawski`, not `CN=Android Debug`. `v1 scheme: false` is fine — v1 only matters below API 24 and `minSdk` is 24.

**`tauri.properties` must live in `gen/android/app/`**, not `gen/android/`. `app/build.gradle.kts` reads it with `file("tauri.properties")`, which resolves against the *module* directory; a copy one level up is silently ignored and versionCode falls back to `1`.

## Versioning
**`package.json` is the single source of truth**; `scripts/version.mjs` derives every other
file and `bun run version:check` fails on drift. Before it existed the five files disagreed
in three different ways — `Cargo.toml` had never left `0.1.0`, and a commit titled "1.8"
bumped nothing at all.

- `bun run version:set <x.y.z>` rewrites `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and the Android `versionName`, and
  **increments** `versionCode`. Then `git tag v<x.y.z>` — the repo had no tags before v1.9.0.
- **Never hand-edit `tauri.properties`.** `versionCode` is monotonic, not derived: Android
  refuses an install whose code is not greater than the installed one, so it is bumped rather
  than set, and `--check` ignores it.
- **Never run a blanket `cargo update`** to refresh the lock. `Cargo.lock` pins
  `webauthn-authenticator-rs`/`-proto` at 0.5.1 (see "Passkeys and accounts"), and a blanket
  update breaks the build. The script rewrites the `albas` entry by name instead.
- The edits are regex-based rather than parse-and-reserialise, so files keep their formatting
  — `tauri.conf.json` is indented with six spaces and `JSON.stringify` would reflow all of it.
- **Tauri's bundler reads `tauri.conf.json`, not `Cargo.toml`.** That is why the deb was
  `albas_1.7.1_amd64.deb` while Cargo said `0.1.0`; keeping Cargo in step is for sanity, not
  function.
- **`sync-server/` is versioned independently** (`0.2.0`) and tagged separately in the GHCR
  image. It is a separately deployed artifact whose wire protocol is backward-compatible by
  design, so a server rebuild does not imply an app release.
- The running version is shown in two places, both fed by `__APP_VERSION__` (injected by Vite
  from `package.json` — see `define` in `vite.config.ts`): Settings → **About**, and the
  desktop status bar's left module.

## Websites
The repo includes two separate web projects:

1. **`web/` — Public web console** at `albas.danni-dev.com` (alongside `/api` sync endpoint). Read-only user interface for synced data. Bun-based, deployed to production. Currently a blank template; implementation is planned after the app redesign lands.

2. **Admin console** — Restricted-access console running on a friend's VM, reachable only via Cloudflare tunnel. Staff-only interface for server administration, user management, and debugging. Lives in `web/` (`AdminConsole.tsx`, still on mock data) with its own `package.json`, `tsconfig.json` and lockfile — the root `tsconfig.json` is `"include": ["src"]`, so it is genuinely outside this app's build and route table. Separate deployment and auth model from the public web console. Its redesign mock lived in the v1.10 design handoff, which has been deleted now that the redesign has landed (recoverable from git history).

## Domain and origins
The **public app and web console share one origin**, `albas.danni-dev.com` — the JSON API under `/api`,
Android's assetlinks at the domain root, and the web console at `/`.

- **The host is the WebAuthn relying party.** `sync-server/src/passkey.rs` derives `rp_id`
  from the host of `ALBAS_SYNC_ORIGIN`, and an authenticator only releases a credential to
  something proving it speaks for that host *or a parent of it*. Hence one origin: a console
  on a sibling host could never use the app's passkeys. Hence also **not** the
  `danni-dev.com` apex — the apex carries unrelated services, and an apex RP ID would make an
  Albas passkey offerable to every one of them.
- **Changing the domain invalidates every passkey.** There is no migration; accounts are
  re-created. Budget for that before moving it again.
- **Three files must move together**, and each says so: `src/syncServer.ts` (base form, no
  `/sync`), `src-tauri/src/sync.rs` `DEFAULT_URL` (endpoint form, *with* `/sync`, because
  `run` POSTs to it as-is), and the Android `asset_statements` in `values/strings.xml`
  (domain **root**, not `/api`).
- **`ALBAS_SYNC_ANDROID_ORIGIN` is domain-independent** — it is an `android:apk-key-hash:`
  value derived from the release signing key. Don't touch it when the domain moves.
- **nginx strips the `/api` prefix** via the trailing slash on `proxy_pass
  http://albas-sync:8787/;`, so the Rust routes are unchanged. A slashless `proxy_pass`
  breaks every endpoint at once. Configs live in `sync-server/nginx/`.
- **A stored `__sync_url` always beats `DEFAULT_URL`**, so an existing install would keep
  syncing to the old host after an update — silently, with no error to explain it. `db.rs`'s
  `repoint_default_server` rewrites exactly the former defaults listed in `SUPERSEDED_URLS`,
  once each, flagged in `meta`. **Add the outgoing URL to that list whenever the default
  changes**, or the next move repeats the problem.
- **`check_url` is https-only — loopback is no longer exempt** (was: plain `http://` against
  `localhost`/`127.0.0.1`). That exemption was the only way a device could come to store
  `http://localhost:8787/sync`, which then sat in front of `DEFAULT_URL` forever. Alongside
  `SUPERSEDED_URLS`, `repoint_default_server` now also sweeps *any* stored URL that
  `check_url` rejects back to the default — unflagged and unconditional, because no such URL
  can have been typed in deliberately. Restoring local http testing means restoring the
  loopback arm **and** clearing the stored setting.
- **The server is not user-editable, and is not shown.** The Server field is gone from both
  Welcome and Settings → Account & sync, `usePasskeyAuth` supplies `DEFAULT_SYNC_URL` itself
  (its `signIn`/`createAccount` take no URL), and the signed-in line names the account only.
  There is one hosted server; a URL box was a way to mistype it, and — before `check_url`
  went https-only — the way a stray `http://localhost:8787/sync` came to sit in front of the
  real one forever. Nothing in the UI reads or writes a URL any more: the manual-token path
  posts to `syncEndpoint(DEFAULT_SYNC_URL)`. Repointing a build means editing the two
  constants (plus `strings.xml`), not restoring the field.
- **`tauri.conf.json` is parsed as strict JSON by `tauri-build`** even though the CLI's
  `tauri info` tolerates comments. Don't put `//` in it — the build fails with "key must be
  a string" at the offending line.

## Project direction
Recorded so a future session doesn't relitigate settled questions.

- **One origin.** The API and the (planned) web console will both be served from
  `albas.danni-dev.com`, replacing `albas-api.danni-dev.com`. Deliberately a subdomain and
  **not** the `danni-dev.com` apex: WebAuthn's RP ID is a security boundary, the apex will
  also host a portfolio, a Minecraft server and a photo cloud, and an apex RP ID would make an
  Albas passkey offerable to all of them. Same-origin also means no CORS layer is ever needed.
- **Passkeys are not migratable across that move** — they are bound to the old RP ID — so the
  accounts get wiped rather than migrated. Nothing on the server is worth keeping.
- **Payloads stay plaintext for now**, and that is documented rather than hidden. E2E
  encryption is mutually exclusive with the planned admin payload viewer, and it also breaks
  read-only sharing (the server cannot hand another account rows it cannot decrypt). The cheap
  intermediate step, when it matters, is encryption at rest with a server-held key.
- **Monorepo, and the server host has no clone.** The CI path filter already gives
  `sync-server/` an independent release pipeline; meanwhile `sync.rs`'s `TABLES` and the
  server's share groups are co-designed and must agree. The host needs only
  `docker-compose.yml`, `.env` and the nginx configs — everything else arrives as an image.
- **Local-only Albas is free; the hosted server is the paid part.** SQLite on the device
  stays the source of truth and the app must never require an account to be useful — "Use
  offline" on the Welcome screen is load-bearing, not a courtesy. Sync, sharing and the web
  console are what an account buys. Accounts and registration are **free for now**
  (`ALBAS_SYNC_SIGNUPS` still defaults to open); the subscription is not built, so don't add
  entitlement checks ahead of it. Invites survive for the one job open signup can't do:
  attaching a passkey to an account that already exists.
- **Not moving to AWS.** The ordered bottlenecks are: no backups; unbounded tombstone growth;
  the in-memory pending-ceremony map, which prevents running two replicas at all; then the
  single `Mutex<Connection>`. None are user-count-driven. The realistic path is the current VM
  → a home box, and the image already builds multi-arch for ARM.

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

## Typography and the app mark (v1.10 redesign)
**Outfit for body/UI, Sora for headings, the wordmark and card titles.** Both are
self-hosted from `public/Outfit/` and `public/Sora/` via the `@font-face` pair at the top of
`App.css`, and exposed as `--t-font-body` / `--t-font-heading`. **Nothing is fetched from
fonts.googleapis.com** — the `<link>` is out of `index.html`, which matters for an offline
Android build's first paint. Inter survives only as a fallback name in the stack.

- The `* { font-family: var(--t-font-body) }` rule must stay inside `@layer base`. Unlayered
  declarations outrank *every* layered one regardless of specificity, so as a bare `*` it
  would beat `.font-heading` and no title could opt out.
- `--font-title` is kept as an alias of `--t-font-heading`, so the pre-redesign `font-title`
  call sites (`RemindersField`, `PinDialog`, `CalendarNav`, `EventForm`) land on Sora
  unedited. Both faces are variable, so `font-bold` is real weight, not synthesised — the
  old Slabo single-weight caveat is gone with Slabo.
- `public/Slabo27px-Regular.ttf` is now unreferenced; it is kept only because deleting a
  tracked asset is a separate decision.

`public/icon.svg` is the app mark. It's the favicon in `index.html`, the source for every
platform icon (`bun run tauri icon public/icon.svg` rewrites `src-tauri/icons/` *and* the
Android `mipmap-*` launchers), and the sidebar logo redraws its three strokes inline in
`AppShell.tsx`.

## Icons — lucide (v1.7.1)
**Every icon in the app is a lucide-react component.** The Material Symbols webfont is gone: the `<link>` is out of `index.html`, `.material-symbols-outlined` is out of `App.css`, and there is no `Sym` helper left in `components/ui/`. Reintroducing a glyph-name string anywhere is a regression.

This reverses the v1.6 rule (which stripped lucide *out* of generated shadcn files to avoid a second icon system). The trade went the other way once the count of distinct glyphs was known: lucide is tree-shaken inline SVG, so an offline Android build no longer waits on fonts.googleapis.com for its checkmarks, and generated shadcn components can now land unedited.

Two consequences worth knowing:
- **lucide is stroke-only.** Anything that used `fontVariationSettings: 'FILL' 1` for an active/selected state now uses `fill="currentColor"` (the star) or a heavier `strokeWidth` (the rail's active item).
- Size is a `size={n}` prop, not `fontSize`. `svg.lucide` in `App.css` carries `flex-shrink: 0` so call sites don't each need it. Note the shadcn class strings contain `[&_svg:not([class*='size-'])]:size-4`, which *will* override a `size` prop inside a menu or select trigger — that's stock behaviour, not a bug.

`components/ui/dropdown-menu.tsx` currently has no importers (v1.7.1 replaced the calendar's view menu); it is kept generated-and-themed rather than deleted.

## Home, categories, and the event form (v1.7)
- **On a phone, `calendar` is the home page.** `HomeView` stacks the calendar (bounded height, so the rest is reachable), every habit, and the tasks in one scroll. There is **no To-Do destination in the drawer** — `Sidebar` filters `desktopOnly` items out, and `AppShell`/`TopBar` both fold `activeView === 'todos'` into Home so narrowing a desktop window mid-view doesn't land on a blank screen.
- **`TodoPanel` is a composer**, not a list: `todo/HabitsSection` and `todo/TasksSection`. Home and the right panel both build from those two, which is why neither renders the other's markup.
- **To-dos have `category` (free text) and `important`.** Categories are derived from what's in use — there is no managed list, nothing to rename, and nothing to migrate. Grouping/sorting lives in `todoLogic`: `groupTasks` (uncategorised first, then A–Z), `byImportanceThenDue`, `isOverdue`. **Completed is a section, not a category** — a finished to-do keeps its category and star, it just sorts to the bottom, and done-ness still derives from `completions` rather than a second flag that could disagree.
- Schema **v4** adds `category`/`important` to `habits`. `SCHEMA` carries the current shape and the `ALTER`s only run for existing DBs (an `ALTER` on a fresh DB fails as a duplicate column) — and both columns are in `sync.rs` `TABLES`. (v5 adds `shared_rows`; see "Read-only sharing".)
- **The desktop month grid sizes itself.** It measures its own rows area and derives a width for 3:2 day cells, capped by `calc(100vw - 4rem - 48px - 280px)` so it can never starve the panel — it sits in a `flex-none` column, so nothing downstream can shrink it. `RightPanel` is a flex child (`flex-1 min-w-[280px]`) that absorbs the surplus.
- **The event form is three date/time rows** — all-day, then start and end as date-left/time-right. All-day drops the time column outright. New events default to today, the current quarter hour, and +1 hour. Moving the start date drags the end with it.
- **Reminders are a list you edit** (`forms/RemindersField`), with presets and a custom lead time, rather than four preset toggles.
- `color-scheme` is set per theme in `App.css`. Components used to hardcode `colorScheme: 'dark'` inline, which left native date/time popups black in the light theme — **don't reintroduce that**; the theme handles it.

## Unified data model (v1.3)
Three concepts:
- **Todo** (`src/types.ts`) — anything that needs doing. Tasks, habits, and chores are all Todos distinguished only by their `schedule` (`Repeat`): `once` = task, fixed cadences (`daily`/`weekdays`/`every` with `fromDone: false`/`timesPer`) = habit, `every` with `fromDone: true` = chore (next due counts from the last completion). Stored in the SQLite `habits` table / `save_habit` commands for backward compatibility.
- **CalendarEvent** — anything that's just *there* on the calendar. The old Period type was merged in: a period is now a long all-day event (spans ≥ 7 days render as thin lanes). Legacy `tasks`/`periods` rows are converted to todos/events once at load in `AppContext`.
- **WeightEntry** — one scale reading (`weights` table). Weight is **always stored in kg**; `weightUnit` is a display setting. Wyze rows use the upstream `data_id` as their id, so re-syncing a range is idempotent. Logic in `src/weightLogic.ts`, UI in `WeightPanel.tsx`.

Colors are hex strings picked from a palette + native color-wheel input (`src/colors.ts`; legacy named keys resolve via `colorHex()`).

## Theming (v1.10)
**Two themes: `light` (default) and `dark`**, selected in Settings and applied as
`data-theme` on `<html>`. The v1.4 four-theme set is gone — `grey-high` and `grey-low` were
dropped with the redesign and `ThemeName` is now `'light' | 'dark'`. A database still
holding a dropped name fails `readTheme`'s `THEMES.includes` check and falls back to
`light`.

`src/App.css` defines ~74 `--t-*` custom properties on `:root` (light) and redefines the ~50
that change under `[data-theme='dark']`. A `@theme inline` block maps Tailwind's colour
names onto them, so utilities emit `var(--t-…)` and a runtime swap repaints everything.
**Never hardcode a hex in a component** — a literal cannot repaint, which is the entire
reason the theme swap works at all. The one legitimate exception is colour *data*: the
`PALETTE` and `CATEGORIES` arrays in `AddModal.tsx` are user-chosen values stored as hex in
SQLite, not chrome.

Things that are load-bearing and easy to get wrong:
- **The sheet follows the theme, it does not invert it.** Most `--t-sheet*` tokens are
  aliases of `--t-surface`/`--t-subtle` and move for free. The three carrying literals must
  be restated in the dark block: `--t-grid-line` (or the month grid loses its cell borders),
  `--t-past-x` (a dark ink X is invisible on a dark sheet), and `--t-past-cell`/`-ink`.
- **The `--t-cat-*` ramps are not uniformly darkened.** The mark keeps its hue so a category
  is recognisably itself across themes; `-tint` becomes a low-lightness version sitting just
  above `--t-surface`; `-line` goes one step *brighter* than its tint where light goes one
  step darker; and `-ink` **flips outright** — darkest-of-ramp in light, lightest in dark, or
  every chip label disappears.
- **`--t-accent-deep` has two conflicting roles**: text on `--t-accent-tint`, and the far end
  of the Welcome gate's gradient. A light lavender satisfies both in dark.
- **`color-scheme` is set per theme** (`light` on `:root`, `dark` in the dark block). This is
  what keeps native date/time pickers legible — the redesign's event form is full of them.
  Don't reintroduce a hardcoded `colorScheme: 'dark'` inline.
- Radius is **0 everywhere**, enforced by an unlayered `*,*::before,*::after{border-radius:0}`
  reset plus every `--radius-*` key zeroed. Unlayered so it outranks the utilities layer. The
  one thing that beats it is an **inline** `style={{borderRadius}}` — that is exactly how the
  calendar chips regressed once; don't write one.

The theme is mirrored to `localStorage['albas-theme']` purely so the inline script in
`index.html` can paint before React mounts; it validates against the two live names, and
SQLite (`meta`, `setting:` prefix) stays the source of truth.

## UI primitives — shadcn/ui (v1.6)
Overlays and form controls are Radix primitives generated by shadcn into `src/components/ui/`. They were adopted for *behaviour* — focus trap, Escape, scroll lock, `aria-*`, listbox typeahead — **not** for theming: the `--t-*` system above predates them and stays the single source of truth.

**The bridge.** The `@theme inline` block in `App.css` aliases shadcn's fixed colour vocabulary (`background`, `card`, `popover`, `muted`, `border`, `ring`, …) onto the same `--t-*` variables, so a generated component inherits all four themes untouched. Two things to know:
- **`accent` is a false friend.** In shadcn it means a menu item's *hover surface*; the brand colour is `--t-accent`, exposed as `primary`. `bg-accent` will not give you blue.
- Verified through the portal: Radix renders menus and dialogs at the end of `<body>`, still inside `<html data-theme>`, so a live theme swap repaints them.

**Rules for a generated component before it lands:**
1. ~~**Strip `lucide-react`.**~~ **Reversed in v1.7.1 — keep the stock lucide imports.** lucide is now the app's only icon system (see "Icons"), so a generated file's icons need no edit at all. The local `Sym` helpers are gone from `checkbox.tsx`, `select.tsx`, `dropdown-menu.tsx`, `dialog.tsx` and `sheet.tsx`.
2. **No literal colours.** Stock files ship `bg-black/50` scrims; use `bg-scrim`, which is themed and carries the blur.
3. **Watch t-shirt-size utilities.** This app defines its own spacing scale (`--spacing-sm: 12px`, `--spacing-lg: 40px`, from the original Stitch design), so shadcn's `sm:max-w-lg` renders a **40px-wide dialog** and `sm:max-w-sm` a 12px drawer. Both were removed from `dialog.tsx`/`sheet.tsx`; width belongs to the call site. Note `tailwind-merge` does **not** dedupe across responsive variants, so an unprefixed `max-w-` at a call site cannot override a `sm:`-prefixed one — that's why they had to go rather than be overridden.
4. **Don't import shadcn's `Button`.** `forms/shared.tsx` already owns this app's button vocabulary (`SubmitButton`, `EditActions`); `DialogFooter`'s optional close button was deleted for that reason.

Tailwind v4 also defaults `border-color` to `currentColor`, and generated components write a bare `border` expecting a themed default — hence the `@layer base` border rule in `App.css`. Without it every shadcn border draws in the text colour.

`forms/shared.tsx` is deliberately the **façade**: `Select`, `CheckboxRow`, `SegmentedControl`, `inputClass` keep their old signatures while their internals are Radix, so the ~19 controls in `Settings.tsx` and both forms never had to change. That swap fixed two theming bugs — a `colorScheme: 'dark'` that forced a dark OS dropdown in the light theme, and an `accent-blue-600` checkbox that ignored the theme accent.

Cost: the first Radix component is ~39 kB gz (it pays for the shared dismissable-layer/focus-scope/portal machinery); each one after is ~1–7 kB.

## Responsive / Android
`useIsMobile()` (`src/useMedia.ts`) is a `matchMedia('(max-width: 767px)')` hook — narrowing the desktop window exercises the exact mobile layout, so test there first.

Below the breakpoint (v1.10): `.sidebar` and `.bottom-bar` are hidden and `HomeView` supplies the mobile chrome on the dashboard route; every other route gets the shell's `.mobile-route-bar` (see "The shell"). `RightPanel` is dropped, and tapping a month tile drills into that day's Day view instead of opening the add modal. The old `TopBar` hamburger/`Sheet` drawer is **gone** along with `TopBar.tsx` itself — a `Sheet` drawer is no longer mounted under 768px, so don't write a hamburger expecting one.

**The month grid is split by layout, not by platform.** It diverged far enough that in-line `isMobile` ternaries were most of the component's complexity, so it's now four files in `src/components/calendar/`:
- `monthModel.ts` — `getCalendarDays` plus `useMonthModel(opts)`, which derives *everything* both layouts draw (week buckets, bar lanes and the `MAX_BAR_LANES` overflow-to-pills fallback, period washes, due dots, per-cell pill selection and `hiddenCount`). `MonthModelOptions` — `pillCap`, `minWeeks`, `dueDots` — is the *entire* difference between the two layouts; it's an object rather than positional args precisely so adding a fourth doesn't renumber the call sites. **All grid logic belongs here** — a fix applied to one layout only is the failure mode this split exists to prevent.
- `monthParts.tsx` — pieces that render identically in both: `PeriodCorners`, `DueDots`, `PeriodTitles`, `BarsOverlay` (parameterised by `top`, which clears the shorter day-number row on a phone).
- `MonthViewDesktop.tsx` / `MonthViewMobile.tsx` — presentational only, no state and no `isMobile`. Each exports its own `PILL_CAP`; mobile also exports `MIN_WEEKS = 6` and `DUE_DOTS = false`. Mobile owns `useMonthSlide`, the swipe animation (see below).
- `MonthView.tsx` — the shell: derives the model, owns the three `AddModal` states, picks a layout. It returns a fragment, so the layout root keeps `flex-1 min-h-0` as a direct flex child of `Calendar`.
- `useMonthSwipe.ts` — horizontal drag / trackpad scroll steps the month, used by the mobile layout only. It returns handler props (plus `touchAction: pan-y`, so vertical scrolling still belongs to the browser), which is why a "presentational" layout may hold it. `onClickCapture` swallows the click that follows a swipe, or lifting your finger over a cell would drill into that day.

**The phone grid is always six rows** (`MIN_WEEKS`, applied by `getCalendarDays`'s `minWeeks`). v1.7 briefly dropped this to the month's natural 4–6 to save height; that is what made a swipe look like the layout changed — the rows are `flex-1` inside `HomeView`'s bounded calendar, so a five-week month draws visibly taller cells than a six-week one, and a six-week month following a five-week one pushed its last week out of the box entirely. Desktop passes nothing and keeps the natural 4–6, because its grid isn't height-bounded the same way.

**No due dots on the phone grid** (`DUE_DOTS = false`). Home lists every habit directly under the calendar, so the dots were the same information in the grid's tightest space.

**Swiping animates** (`useMonthSlide` in `MonthViewMobile`, keyframes `month-slide-next`/`-prev` in `App.css`). The direction is derived from `currentMonth` changing, not passed down from `useMonthSwipe`, so stepping from the top bar or "jump to today" animates identically. Two things are load-bearing: `useLayoutEffect` (an effect paints the new month at rest for a frame first, which reads as a stutter), and the `key` on the animated wrapper (without a changing key the animation won't replay on a second swipe the same way). The animated wrapper is a separate element from the scroll container — a transform inside an `overflow-y: auto` box makes the browser offer a horizontal scrollbar for the duration.

**There is no "today" marker in the month grid.** Elapsed cells are struck through with `PastX` instead, so today reads as the first day that isn't crossed. The strike uses `--t-past-x` (per theme, like `--t-grid-line`) rather than literal black, which would be invisible on the three themes whose sheet is dark. Week view still marks today in its column header.

`AppShell`'s remaining `isMobile` branches are deliberate — a layout shell choosing rail-vs-drawer is not the same problem.

## One list, one title (v1.4)
- **There is no Agenda panel.** `DayPanel` was deleted and the day's events live only on the calendar (Day view). `TodoPanel` is the single list surface, used both as the main view and as the whole of `RightPanel`. Re-adding a second list is what caused a habit to render twice.
- **Habits belong to the calendar, not to every view** (v1.7.1). `AppShell` mounts `RightPanel` for `activeView === 'calendar'` only — it used to render beside Settings and Weight too — and `TodoPanel` takes a `habits` prop, on in the panel and off in the To-Do view. A habit is never *done*, so in a list of things left to do it was only padding the top; and its week strip is most of a 280px panel but nothing in a full-width view. `TodoPanel`'s empty-state check counts only what that surface would show, or the To-Do view goes blank for someone who has only habits.
- **The title used to live in `TopBar`, which no longer exists** (see "The shell" above); `calendarTitle()` in `src/dates.ts` still builds it and the shell renders it. The rule below still holds
- **Historic note**, built by `calendarTitle()` in `src/dates.ts`; `Calendar` renders navigation only. Month and week views omit the year in the current year — the phone title shares its row with the nav, so a week range that keeps it truncates. Don't reintroduce an `<h2>` in `Calendar` — the month name would render twice.
- **Navigation is `calendar/CalendarNav.tsx`**, and it owns the stepping logic for all three modes. `Calendar` renders it as a row above the sheet on desktop; on mobile `TopBar` renders it `compact` beside the title and `Calendar` renders no row at all. Both call sites mount the same component — putting the arrows in one and the mode switch in the other is how the two get out of sync.
- **The mode switch has two shapes, not one dropdown** (v1.7.1). Desktop is `ModeButtons`: three buttons plus Today, because all three modes are constant destinations and a menu hid two of them behind a click and a read. Mobile is `ModeModal`: a calendar-icon button opening a `Dialog` with a labelled row per mode. Today lives *inside* that modal on mobile and is the only way back there.
- **Mobile drops the prev/next arrows in month view** — the grid is swipeable, and the arrows were a second control for a gesture already there, on the row where space is tightest. Week and day view keep them, because neither is swipeable. If you ever make those swipeable, the arrows go too.

## The shell: sidebar, bottom taskbar, routing (v1.10)
`src/components/AppShell.tsx` owns the whole desktop chrome. `Sidebar.tsx`, `TopBar.tsx` and
`StatusBar.tsx` are **deleted** — the shell absorbed all three, and nothing imports them.

- **Routing is a local `Route` union**, not `ActiveView`: `dashboard | todo | habits | weight
  | settings`. `VIEW_OF` maps each to the persisted `ActiveView` where one exists and
  `routeOf()` maps back. `habits` is deliberately unpersisted — `ActiveView` has no name for
  it — so a restart from Habits lands on the dashboard.
- **Weight is the fifth sidebar item.** The redesign's mock had four and never covered
  weight, which left `WeightPanel` importerless and the entire Wyze scale backend unreachable
  behind a Settings card that still worked. The fifth item is a deliberate deviation from the
  design. `WeightPanel` still speaks the pre-redesign token aliases (`text-txt`,
  `bg-fill-strong`), which are still defined — it renders, but it looks like an older screen.
- **`SidebarSlot`** portals a page-specific second section (To-Do's Categories, the
  calendar's) under Menu. The target is held as *state*, not a ref: a ref set during the
  shell's own render is still null on the consumer's first pass and nothing re-renders it.
- **The bottom taskbar** (`BottomBar`) runs the full width: version left, sync state and
  account right. Identical on every route because it belongs to the shell, not a screen.
  `initialsOf()` is exported from here — Settings' avatar uses the same one.
- **Mobile navigation lives in two places, and that is the trap.** Under 768px `.sidebar` and
  `.bottom-bar` are both `display:none`, because `HomeView` brings the entire mobile chrome —
  its own header and tab row. But `HomeView` only mounts on `dashboard`. A phone on `todo`,
  `habits`, `weight` or `settings` — *including a cold start whose persisted `activeView` was
  `settings`* — would otherwise render with no navigation at all. `.mobile-route-bar` in the
  shell is the back bar that covers those routes. If you add a route, it gets the bar for
  free; if you add mobile chrome to a screen, don't assume the shell's is showing.

## First day of the week (v1.4)
`firstDayOfWeek` (settings blob, `0` = Sunday, `1` = Monday, default Monday) is threaded explicitly — there is no module-level global. `weekOf()` and `getCalendarDays()` take it as a trailing parameter defaulting to `1`, as do `isDueOn` / `doneCountIn` / `streakOf` / `statusLabel` / `repeatLabel` (`todoLogic.ts`), `weeklyRows` (`weightLogic.ts`), `calendarTitle`, and `remindDueTodos`. **A missing argument silently means Monday**, so new call sites must pass it from `useApp()`.

Two rules that are easy to get wrong:
- Weekday label tables are written **Sunday-first** (matching `getDay()`) and rotated for display with `rotateWeek()`. `weekdayAt(i, firstDay)` maps a column back to a real weekday.
- **Weekend styling must come from `getDay()`, not the column index** — under a Sunday start, columns 5 and 6 are Friday and Saturday.
- `Repeat.weekdays` stores absolute `getDay()` values, so scheduling itself is week-start independent — only the *display order* of the picker rotates.

Known behavioural consequence: `timesPer: 'week'` to-dos bucket completions with `weekOf`, so flipping the setting re-partitions past completions and a "3× per week" habit's streak/quota can change value. Settings says so inline.

**`min-h-0` is load-bearing** on every `flex flex-col` ancestor of `HourGrid` — flex items default to `min-height: auto`, which lets the 1152px hour body dictate the container height and silently defeats `overflow-y-auto`. This is what broke Week/Day view before v1.3.

## Device sync (v1.5)
Optional, off until configured in Settings → Account & sync. SQLite stays the source of truth and the app stays fully offline-capable; the server only reconciles devices.

- **Client**: `src-tauri/src/sync.rs`. `TABLES` lists each synced table's PK and columns — **adding a column to the schema means adding it there too**, or it silently won't sync (`table_specs_match_the_schema` catches a typo'd name, not an omitted column).
- **Server**: `sync-server/` — a standalone Axum binary storing opaque `(account, table, pk) -> payload` rows. It never parses app data, so it needs no redeploy when the app schema changes. `sync-server/README.md` has the protocol and deployment.
- **Accounts live on the server, not in the app.** Each account owns a fully isolated row set, unlocked by **per-device tokens** (`tokens` table, only SHA-256 stored) — the token a device sends to `/sync` *is* the identity. `ALBAS_SYNC_TOKEN` still works: it creates/re-keys the `owner` account's `env`-labelled token, leaving passkey-minted tokens alone. Two migrations run on first start and must both keep working: a pre-account database (rows get `account_id` = owner) and the brief accounts-with-inline-`token_hash` schema (credentials move into `tokens`); both preserve `seq`, so existing devices' watermarks stay valid.
- **Two clocks, deliberately**: `updated_at` (device clock) decides *who wins* via last-write-wins; `seq` (server-assigned, monotonic) decides *what a device hasn't seen*. Clients resume from `seq`, so a skewed device clock can never make another device skip a row. Don't collapse these into one.
- Conflict resolution is **per row, not per field** — two offline edits to different fields of one to-do keep only the later row wholesale.
- **Settings are not synced.** On Android the Wyze credentials live in `meta` under `setting:__wyze_credentials` (no keyring backend), so syncing settings wholesale would upload a plaintext password. The `__` prefix marks keys that must stay local: `__sync_url`, `__sync_token`, `__sync_account`, `__welcome_done`, `__shared_hidden`.
- Syncs once per launch (an effect in `AppContext` keyed on `loaded`) plus the manual button. A pull writes to SQLite from Rust, bypassing React, so anything that syncs must call `reloadFromStore()` afterwards — and the reload condition is `pulled > 0 || sharedChanged`, not `pulled` alone.

## Passkeys and accounts (v1.8)
**Ceremonies run in-app, not in a browser** — `tauri-plugin-webauthn` drives the platform authenticator directly (Linux CTAP2 USB keys via `webauthn-authenticator-rs`, Android via Credential Manager). This is why there's no browser hop: the WebView itself has no authenticator plumbing, but the plugin bypasses the WebView entirely. macOS/iOS are unsupported by the plugin.

- **The plugin pins two crates.** v0.2.0 doesn't compile against `webauthn-rs-proto >= 0.5.2` (`CredProps.rk` became `Option<bool>`), so `src-tauri/Cargo.lock` holds `webauthn-authenticator-rs`/`-proto` at 0.5.1. A blanket `cargo update` breaks the build until upstream fixes it.
- **Android needs `minSdk = 28`** (bumped from 24), an `asset_statements` meta-data entry in the tracked `AndroidManifest.xml`, and the matching Digital Asset Links JSON served by the server (`ALBAS_SYNC_ASSETLINKS` → `/.well-known/assetlinks.json`). The domain in `values/strings.xml` is a placeholder — point it at the real server. Credential Manager asserts an `android:apk-key-hash:…` origin rather than the https one, hence `ALBAS_SYNC_ANDROID_ORIGIN`.
- **Login is discoverable/usernameless**: the account is found by credential id, so the registration-time user UUID is a throwaway. `src/auth.ts` forces `residentKey: 'required'` before `register` — webauthn-rs only *prefers* it and a security key may downgrade, which would silently break sign-in later.
- **Registration is open by default** (`ALBAS_SYNC_SIGNUPS=invite` locks it down). Invites remain for one irreplaceable job: attaching a passkey to an account that already exists needs an invite naming it exactly — otherwise open signup would let anyone claim the `owner` account.
- Signing in mints a token and **resets every sync watermark** plus the shared cache (`account.rs`): they were scoped to whatever account this device synced before.
- `src/components/auth/usePasskeyAuth.ts` is the one flow-state hook (Welcome and Settings
  both use it). Its `run()` takes `adoptsSession`: a login marks the welcome screen done and
  reloads everything Rust wrote behind React's back, while adding a passkey to the session
  you are already in must do neither. See "Sign-in methods" below. Linux security keys ask for a PIN mid-ceremony via plugin events → `PinDialog`.

## Sign-in methods (v1.10)
Three now exist. **Passkeys remain primary**; the other two are additions, not replacements,
and the app must still be fully usable with no account at all.

**The registry is the extension point.** `src/authMethods/registry.ts` defines `AuthMethod`
(`id`, `order`, `load(ctx)`, optional `Action`); `src/authMethods/index.ts` is a barrel whose
**import list is fixed** — `./passkey`, `./password`, `./totp` — so adding a method never
means editing a file someone else is editing. Settings renders `authMethods()` and never
names a method itself.

The contract that matters: **`load()` returns credentials that really exist.** This table is
the user's record of how their account can be opened, so a method that is unimplemented, or
half-enrolled, contributes **zero rows** rather than an aspirational one. That rule is why
the redesign's fabricated table (Google / iCloud Keychain / Face ID / …) is gone, and why an
unconfirmed TOTP secret does not appear.

- **Passkeys** — ceremonies go through Tauri because they need the OS authenticator.
  Self-service `POST /passkeys/start` + `/finish` register an *additional* passkey using the
  bearer token for identity, so no admin invite is involved; finish re-checks the token still
  resolves to the account the ceremony started for. The start call sends existing credential
  ids as `exclude_credentials`. `complete_registration` always mints a token, so the
  add-passkey path deletes it immediately — the device keeps the session it already has, and
  no unused credential is left on the server. `GET /passkeys` labels rows from the credential
  id, because the table stores no device name and inventing one would be a lie.
- **Password** — plain `fetch`, no Tauri. Argon2id via the `argon2` crate into
  `accounts.password_hash`; **never** `token_hash`, which is a bare SHA for high-entropy
  tokens. Unknown account and wrong password return an identical 401 after an identical dummy
  verification. `DELETE /password` refuses with 409 if it is the only credential.
- **TOTP** — plain `fetch`, `totp-rs` server-side, QR rendered **client-side** from the
  `otpauth://` URI with `qrcode.react` (no image crate). `totp_confirmed` only flips after a
  code verifies, so an abandoned enrollment can't lock anyone out. Re-enrolling while
  confirmed is 409.
- **TOTP is a second factor for password login only.** `login/password` calls
  `totp::verify_if_enrolled`; passkey login deliberately does not. A passkey is already
  possession plus user verification, and its ceremony runs through a Tauri plugin with
  nowhere to prompt for a typed code. The UI says so rather than implying broader protection.

**Adding a column to `accounts` means adding an `ensure_column` call in `init_db`.**
`CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a column declared only in
`SCHEMA` never reaches a database that already exists. `grant_rev` had exactly this bug
before v1.10 and is now backfilled alongside the three new columns.

## Read-only sharing (v1.8)
An account can expose its calendar and/or to-dos to another, one-way and read-only.

- **Scopes are per table group, because the server never parses payloads**: `calendar` = events + periods, `todos` = habits + habit_completions + tasks. To-dos and habits therefore share one toggle. **Weights are structurally unshareable** — they appear in no group, and `sync.rs` drops a weights row defensively even if a server sent one.
- **`grantRev` is the invalidation channel.** Every grant change bumps the grantee's revision; on mismatch the server sends a full tombstone-free snapshot and the client wipes `shared_rows` first. Without it a revoked share would linger forever, since incremental pulls only carry changes.
- **Client cache is `shared_rows` (schema v5)** — never in `sync::TABLES`, or another person's rows would be pushed back under your account. `db::load_shared` hands raw rows to `src/sharedLogic.ts`, which maps them to typed events/todos. **Adding a synced column means touching three places now**: the schema, `sync.rs` `TABLES`, and the `sharedLogic.ts` mapping.
- **Shared ids are namespaced `${owner}:${pk}`**, so they can never collide with local ids in occurrence keys or be found by `updateEvent`/`deleteTodo`. Shared events also carry `sharedBy`, which is the single flag every render site keys off (`src/sharedDisplay.ts` centralises the dimming, owner-initial prefix and tooltip). Reminders are stripped in the mapping — your phone should not buzz for someone else's appointment.
- Read-only is enforced in the **three calendar shells** (`MonthView`, `WeekView`, `DayView` all guard on `sharedBy` before opening a modal), not in the leaf components. `TodoPanel` renders a per-owner block using `HabitsSection`/`TasksSection`'s `todos`/`readOnly` props.
- **Hiding an incoming share is device-local** (`__shared_hidden`, never synced) — it stops drawing, it doesn't revoke.

## Wyze scale sync
`src-tauri/src/wyze.rs` ports the community `shauntarves/wyze-sdk` request shapes (Wyze has no public API). Login needs email + password + an API Key/Key ID from developer-api-console.wyze.com — the API key acts as the second factor, so it works with 2FA on. Requests carry a `signature2` header: HMAC-MD5 of the body (for GET, query params joined **sorted by key**) keyed by `md5(access_token + salt)`. Both the sort order and the exact body bytes are load-bearing; a mismatch surfaces as a 403. `cargo test --lib` pins the hashes against the Python reference — check those first if sync breaks.

Credentials go to the OS keyring on desktop; Android has no keyring backend, so they fall back to the app-private SQLite file (sandboxed, not encrypted).

## Architecture

The app has two distinct layers that communicate via Tauri's IPC bridge:

- **Frontend** (`src/`): React app rendered in a WebView. Entry point is `src/main.tsx`, which mounts `AppShell` inside `AppProvider` (`src/context/AppContext.tsx`) — the single source of truth for todos, events, weights, settings, selected date, and active view. Persistence goes through `src/persistence.ts`, which picks SQLite-via-Tauri or a whole-blob `localStorage` fallback (key `albas-data-v1`) for the browser dev server. UI components live in `src/components/`, shared date helpers in `src/dates.ts`, and Tailwind v4 design tokens in `src/App.css`.
- **Backend** (`src-tauri/src/`): Rust. `lib.rs` defines Tauri commands registered with `invoke_handler`; `main.rs` calls `run()`. To expose a new Rust function to the frontend, annotate it with `#[tauri::command]` and add it to `generate_handler![]` in `lib.rs`.

Frontend calls Rust via `invoke()` from `@tauri-apps/api`. Tauri capabilities (permissions) are configured in `src-tauri/capabilities/default.json`.
