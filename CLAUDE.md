# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Albas is a Tauri v2 desktop app — an all-in-one to-do list, calendar, and habit tracker. The frontend is React + TypeScript + Tailwind CSS v4 (custom calendar grid, no calendar library), built with Vite. The backend is Rust via Tauri.

## Commands

```bash
# Run in development — the Hyprland/Wayland WebKit workarounds
# (WEBKIT_DISABLE_DMABUF_RENDERER etc.) are baked into the npm "tauri" script
npm run tauri dev

# Android (SDK lives in ~/Android/Sdk; env vars set in ~/.bashrc)
npm run tauri android dev     # run on connected device/emulator
npm run tauri android build   # build APK

# A standalone APK — one that runs with the computer switched off.
# `android dev` installs a build whose webview loads the UI from the Vite dev
# server over the LAN, so that install is useless away from the desk. `build`
# compiles frontendDist into the binary instead; --debug signs it with the
# Android debug key so it will actually install.
npm run tauri android build -- --debug --apk --target aarch64
# Both commands write app-*-debug.apk to the same path, so check which one you
# have before installing (a LAN address here means it's the dev artifact):
unzip -p src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk \
  assets/tauri.conf.json | grep -o '"devUrl":"[^"]*"'

# Signed release build (see "Android signing" below)
npm run tauri android build -- --apk --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# Build for production
npm run build          # frontend only (tsc + vite)
npm run tauri build    # full app bundle

# Frontend dev server only (no Tauri)
npm run dev
```

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

## TODO LIST
1. To-do reminders only fire on the due day; consider firing at the to-do's `time` when one is set.

## Home, categories, and the event form (v1.7)
- **On a phone, `calendar` is the home page.** `HomeView` stacks the calendar (bounded height, so the rest is reachable), the first three habits, and the tasks in one scroll. There is **no To-Do destination in the drawer** — `Sidebar` filters `desktopOnly` items out, and `AppShell`/`TopBar` both fold `activeView === 'todos'` into Home so narrowing a desktop window mid-view doesn't land on a blank screen.
- **`TodoPanel` is now a composer**, not a list: `todo/HabitsSection` (takes `limit`) and `todo/TasksSection`. Home and the right panel both build from those two, which is why neither renders the other's markup.
- **To-dos have `category` (free text) and `important`.** Categories are derived from what's in use — there is no managed list, nothing to rename, and nothing to migrate. Grouping/sorting lives in `todoLogic`: `groupTasks` (uncategorised first, then A–Z), `byImportanceThenDue`, `isOverdue`. **Completed is a section, not a category** — a finished to-do keeps its category and star, it just sorts to the bottom, and done-ness still derives from `completions` rather than a second flag that could disagree.
- Schema **v4** adds `category`/`important` to `habits`. `SCHEMA` carries the current shape and the `ALTER`s only run for existing DBs (an `ALTER` on a fresh DB fails as a duplicate column) — and both columns are in `sync.rs` `TABLES`.
- **The desktop month grid sizes itself.** It measures its own rows area and derives a width for 3:2 day cells, capped by `calc(100vw - 4rem - 48px - 280px)` so it can never starve the panel — it sits in a `flex-none` column, so nothing downstream can shrink it. `RightPanel` is a flex child (`flex-1 min-w-[280px]`) that absorbs the surplus. On a phone the grid is back to the month's natural 4–6 rows (`MIN_WEEKS = 0`).
- **The event form is three date/time rows** — all-day, then start and end as date-left/time-right. All-day drops the time column outright. New events default to today, the current quarter hour, and +1 hour. Moving the start date drags the end with it.
- **Reminders are a list you edit** (`forms/RemindersField`), with presets and a custom lead time, rather than four preset toggles.
- `color-scheme` is set per theme in `App.css`. Components used to hardcode `colorScheme: 'dark'` inline, which left native date/time popups black in the light theme — **don't reintroduce that**; the theme handles it.

## Unified data model (v1.3)
Three concepts:
- **Todo** (`src/types.ts`) — anything that needs doing. Tasks, habits, and chores are all Todos distinguished only by their `schedule` (`Repeat`): `once` = task, fixed cadences (`daily`/`weekdays`/`every` with `fromDone: false`/`timesPer`) = habit, `every` with `fromDone: true` = chore (next due counts from the last completion). Stored in the SQLite `habits` table / `save_habit` commands for backward compatibility.
- **CalendarEvent** — anything that's just *there* on the calendar. The old Period type was merged in: a period is now a long all-day event (spans ≥ 7 days render as thin lanes). Legacy `tasks`/`periods` rows are converted to todos/events once at load in `AppContext`.
- **WeightEntry** — one scale reading (`weights` table). Weight is **always stored in kg**; `weightUnit` is a display setting. Wyze rows use the upstream `data_id` as their id, so re-syncing a range is idempotent. Logic in `src/weightLogic.ts`, UI in `WeightPanel.tsx`.

Colors are hex strings picked from a palette + native color-wheel input (`src/colors.ts`; legacy named keys resolve via `colorHex()`).

## Theming (v1.4)
Four themes: `dark` (default), `light`, `grey-high`, `grey-low`, selected in Settings and applied as `data-theme` on `<html>`.

`src/App.css` defines a `@theme inline` block mapping Tailwind color names to `--t-*` custom properties, so utilities emit `var(--t-…)` and a runtime theme swap repaints everything — including every existing `bg-primary` call site, since the accent is aliased onto the old M3 names. **Never hardcode a hex or `bg-white/N` in a component**; use the tokens.

Two surface worlds with separate text scales:
- **chrome** (`bg-chrome`, `bg-elevated`, `text-txt`/`-muted`/`-faint`, `bg-fill`/`-strong`/`-stronger`, `border-line`) — sidebar, top bar, panels, modals.
- **sheet** (`bg-sheet`, `bg-sheet-header`, `border-sheet-line`/`-border`, `text-sheet-txt`/`-muted`/`-faint`) — the calendar card. As of v1.4 the sheet *follows* the theme instead of inverting it: a dark surface just above `app-bg` in `dark`/`grey-low`, near-black in `grey-high`, white only in `light`. `--t-grid-line` is the sheet's own cell border and must flip with it.

Because the sheet is dark in three of four themes, tinted chips behind a user-chosen colour use `PILL_BG_ALPHA` (`src/colors.ts`) rather than a hardcoded alpha — the old `1a` washed out to nothing.

The theme is mirrored to `localStorage['albas-theme']` purely so the inline script in `index.html` can paint before React mounts; SQLite (`meta` table, `setting:` prefix) stays the source of truth.

## UI primitives — shadcn/ui (v1.6)
Overlays and form controls are Radix primitives generated by shadcn into `src/components/ui/`. They were adopted for *behaviour* — focus trap, Escape, scroll lock, `aria-*`, listbox typeahead — **not** for theming: the `--t-*` system above predates them and stays the single source of truth.

**The bridge.** The `@theme inline` block in `App.css` aliases shadcn's fixed colour vocabulary (`background`, `card`, `popover`, `muted`, `border`, `ring`, …) onto the same `--t-*` variables, so a generated component inherits all four themes untouched. Two things to know:
- **`accent` is a false friend.** In shadcn it means a menu item's *hover surface*; the brand colour is `--t-accent`, exposed as `primary`. `bg-accent` will not give you blue.
- Verified through the portal: Radix renders menus and dialogs at the end of `<body>`, still inside `<html data-theme>`, so a live theme swap repaints them.

**Rules for a generated component before it lands:**
1. **Strip `lucide-react`.** This app draws icons with Material Symbols; two icon systems means a second webfont. Each `ui/` file has a small local `Sym` helper. When replacing an SVG with a `<span>`, it needs `block` — width/height do nothing on an inline element, and the radio dot renders 0×0 without it.
2. **No literal colours.** Stock files ship `bg-black/50` scrims; use `bg-scrim`, which is themed and carries the blur.
3. **Watch t-shirt-size utilities.** This app defines its own spacing scale (`--spacing-sm: 12px`, `--spacing-lg: 40px`, from the original Stitch design), so shadcn's `sm:max-w-lg` renders a **40px-wide dialog** and `sm:max-w-sm` a 12px drawer. Both were removed from `dialog.tsx`/`sheet.tsx`; width belongs to the call site. Note `tailwind-merge` does **not** dedupe across responsive variants, so an unprefixed `max-w-` at a call site cannot override a `sm:`-prefixed one — that's why they had to go rather than be overridden.
4. **Don't import shadcn's `Button`.** `forms/shared.tsx` already owns this app's button vocabulary (`SubmitButton`, `EditActions`); `DialogFooter`'s optional close button was deleted for that reason.

Tailwind v4 also defaults `border-color` to `currentColor`, and generated components write a bare `border` expecting a themed default — hence the `@layer base` border rule in `App.css`. Without it every shadcn border draws in the text colour.

`forms/shared.tsx` is deliberately the **façade**: `Select`, `CheckboxRow`, `SegmentedControl`, `inputClass` keep their old signatures while their internals are Radix, so the ~19 controls in `Settings.tsx` and both forms never had to change. That swap fixed two theming bugs — a `colorScheme: 'dark'` that forced a dark OS dropdown in the light theme, and an `accent-blue-600` checkbox that ignored the theme accent.

Cost: the first Radix component is ~39 kB gz (it pays for the shared dismissable-layer/focus-scope/portal machinery); each one after is ~1–7 kB.

## Responsive / Android
`useIsMobile()` (`src/useMedia.ts`) is a `matchMedia('(max-width: 767px)')` hook — narrowing the desktop window exercises the exact mobile layout, so test there first.

Below the breakpoint: the icon rail becomes an off-canvas drawer (a `Sheet`, opened by the hamburger in `TopBar`), `RightPanel` is dropped, and tapping a month tile drills into that day's Day view instead of opening the add modal. The calendar view gets `p-0` from `AppShell` so the month grid goes edge-to-edge, and there is **no nav row at all** — `CalendarNav` rides in `TopBar` beside the title (see below).

**The month grid is split by layout, not by platform.** It diverged far enough that in-line `isMobile` ternaries were most of the component's complexity, so it's now four files in `src/components/calendar/`:
- `monthModel.ts` — `getCalendarDays` plus `useMonthModel(pillCap, minWeeks)`, which derives *everything* both layouts draw (week buckets, bar lanes and the `MAX_BAR_LANES` overflow-to-pills fallback, period washes, due dots, per-cell pill selection and `hiddenCount`). Those two arguments are the only inputs that differ. **All grid logic belongs here** — a fix applied to one layout only is the failure mode this split exists to prevent.
- `monthParts.tsx` — pieces that render identically in both: `PeriodCorners`, `DueDots`, `PeriodTitles`, `BarsOverlay` (parameterised by `top`, which clears the shorter day-number row on a phone).
- `MonthViewDesktop.tsx` / `MonthViewMobile.tsx` — presentational only, no state and no `isMobile`. Each exports its own `PILL_CAP`; mobile also exports `MIN_WEEKS = 6`.
- `MonthView.tsx` — the shell: derives the model, owns the three `AddModal` states, picks a layout. It returns a fragment, so the layout root keeps `flex-1 min-h-0` as a direct flex child of `Calendar`.
- `useMonthSwipe.ts` — horizontal drag / trackpad scroll steps the month, used by the mobile layout only. It returns handler props (plus `touchAction: pan-y`, so vertical scrolling still belongs to the browser), which is why a "presentational" layout may hold it. `onClickCapture` swallows the click that follows a swipe, or lifting your finger over a cell would drill into that day.

**The phone grid is always six rows** (`MIN_WEEKS`, applied by `getCalendarDays`'s `minWeeks`): a five-week month stretched over the full height gives cells much taller than their content, and a row height that changes month to month reads as jitter while swiping. Desktop passes `0` and keeps the month's natural 4–6.

**There is no "today" marker in the month grid.** Elapsed cells are struck through with `PastX` instead, so today reads as the first day that isn't crossed. The strike uses `--t-past-x` (per theme, like `--t-grid-line`) rather than literal black, which would be invisible on the three themes whose sheet is dark. Week view still marks today in its column header.

`AppShell`'s remaining `isMobile` branches are deliberate — a layout shell choosing rail-vs-drawer is not the same problem.

## One list, one title (v1.4)
- **There is no Agenda panel.** `DayPanel` was deleted and the day's events live only on the calendar (Day view). `TodoPanel` is the single list surface — habits then to-dos under `HABITS` / `TO-DO` headings — used both as the main view and as the whole of `RightPanel`. Re-adding a second list is what caused a habit to render twice.
- **The title lives in `TopBar`**, built by `calendarTitle()` in `src/dates.ts`; `Calendar` renders navigation only. Month and week views omit the year in the current year — the phone title shares its row with the nav, so a week range that keeps it truncates. Don't reintroduce an `<h2>` in `Calendar` — the month name would render twice.
- **Navigation is `calendar/CalendarNav.tsx`**, prev / `ViewMenu` / next, and it owns the stepping logic for all three modes. `Calendar` renders it as a row above the sheet on desktop; on mobile `TopBar` renders it `compact` beside the title (arrows and mode button as two separate pills, menu anchored `right-0`) and `Calendar` renders no row at all. Both call sites mount the same component — putting the arrows in one and the mode switch in the other is how the two get out of sync.
- The Month/Week/Day switcher and Today are one dropdown (`ViewMenu` in `CalendarNav.tsx`), following the hand-rolled overlay+scrim shape from `EventForm`'s colour picker.

## First day of the week (v1.4)
`firstDayOfWeek` (settings blob, `0` = Sunday, `1` = Monday, default Monday) is threaded explicitly — there is no module-level global. `weekOf()` and `getCalendarDays()` take it as a trailing parameter defaulting to `1`, as do `isDueOn` / `doneCountIn` / `streakOf` / `statusLabel` / `repeatLabel` (`todoLogic.ts`), `weeklyRows` (`weightLogic.ts`), `calendarTitle`, and `remindDueTodos`. **A missing argument silently means Monday**, so new call sites must pass it from `useApp()`.

Two rules that are easy to get wrong:
- Weekday label tables are written **Sunday-first** (matching `getDay()`) and rotated for display with `rotateWeek()`. `weekdayAt(i, firstDay)` maps a column back to a real weekday.
- **Weekend styling must come from `getDay()`, not the column index** — under a Sunday start, columns 5 and 6 are Friday and Saturday.
- `Repeat.weekdays` stores absolute `getDay()` values, so scheduling itself is week-start independent — only the *display order* of the picker rotates.

Known behavioural consequence: `timesPer: 'week'` to-dos bucket completions with `weekOf`, so flipping the setting re-partitions past completions and a "3× per week" habit's streak/quota can change value. Settings says so inline.

**`min-h-0` is load-bearing** on every `flex flex-col` ancestor of `HourGrid` — flex items default to `min-height: auto`, which lets the 1152px hour body dictate the container height and silently defeats `overflow-y-auto`. This is what broke Week/Day view before v1.3.

## Device sync (v1.5)
Optional, off until configured in Settings → Sync. SQLite stays the source of truth and the app stays fully offline-capable; the server only reconciles devices.

- **Client**: `src-tauri/src/sync.rs`. `TABLES` lists each synced table's PK and columns — **adding a column to the schema means adding it there too**, or it silently won't sync (`table_specs_match_the_schema` catches a typo'd name, not an omitted column).
- **Server**: `sync-server/` — a standalone Axum binary storing opaque `(table, pk) -> payload` rows. It never parses app data, so it needs no redeploy when the app schema changes. `sync-server/README.md` has the protocol and deployment.
- **Two clocks, deliberately**: `updated_at` (device clock) decides *who wins* via last-write-wins; `seq` (server-assigned, monotonic) decides *what a device hasn't seen*. Clients resume from `seq`, so a skewed device clock can never make another device skip a row. Don't collapse these into one.
- Conflict resolution is **per row, not per field** — two offline edits to different fields of one to-do keep only the later row wholesale.
- **Settings are not synced.** On Android the Wyze credentials live in `meta` under `setting:__wyze_credentials` (no keyring backend), so syncing settings wholesale would upload a plaintext password. The `__` prefix marks keys that must stay local; `__sync_url`/`__sync_token` use it too.
- Syncs once per launch (an effect in `AppContext` keyed on `loaded`) plus the manual button. A pull writes to SQLite from Rust, bypassing React, so anything that syncs must call `reloadFromStore()` afterwards.

## Wyze scale sync
`src-tauri/src/wyze.rs` ports the community `shauntarves/wyze-sdk` request shapes (Wyze has no public API). Login needs email + password + an API Key/Key ID from developer-api-console.wyze.com — the API key acts as the second factor, so it works with 2FA on. Requests carry a `signature2` header: HMAC-MD5 of the body (for GET, query params joined **sorted by key**) keyed by `md5(access_token + salt)`. Both the sort order and the exact body bytes are load-bearing; a mismatch surfaces as a 403. `cargo test --lib` pins the hashes against the Python reference — check those first if sync breaks.

Credentials go to the OS keyring on desktop; Android has no keyring backend, so they fall back to the app-private SQLite file (sandboxed, not encrypted).

## Architecture

The app has two distinct layers that communicate via Tauri's IPC bridge:

- **Frontend** (`src/`): React app rendered in a WebView. Entry point is `src/main.tsx`, which mounts `AppShell` inside `AppProvider` (`src/context/AppContext.tsx`) — the single source of truth for todos, events, weights, settings, selected date, and active view. Persistence goes through `src/persistence.ts`, which picks SQLite-via-Tauri or a whole-blob `localStorage` fallback (key `albas-data-v1`) for the browser dev server. UI components live in `src/components/`, shared date helpers in `src/dates.ts`, and Tailwind v4 design tokens in `src/App.css`.
- **Backend** (`src-tauri/src/`): Rust. `lib.rs` defines Tauri commands registered with `invoke_handler`; `main.rs` calls `run()`. To expose a new Rust function to the frontend, annotate it with `#[tauri::command]` and add it to `generate_handler![]` in `lib.rs`.

Frontend calls Rust via `invoke()` from `@tauri-apps/api`. Tauri capabilities (permissions) are configured in `src-tauri/capabilities/default.json`.

I'm building a React-based Tauri productivity app called "Albas" with integrated calendar, to-do list, and habit tracker. I have a design from Google Stitch that I'll paste below.

## Requirements:
1. **Convert to React Components** - Transform the HTML/CSS into proper, reusable React components (not a single file)
2. **Component Structure**:
   - Calendar component (month view, clickable dates)
   - To-Do list with add/edit/delete functionality
   - Habit tracker with streak tracking
   - Sidebar navigation
   - Main layout shell

3. **Interconnected Features**:
   - To-dos can be assigned to calendar dates
   - Habits appear on calendar when due
   - Clicking a date shows tasks and habits for that day
   - State management (use React hooks) to sync all three

4. **Tauri Ready**:
   - Use standard React hooks (useState, useContext for shared state)
   - No external state libraries yet (keep it simple)
   - Structure so it's easy to add Tauri commands later

5. **Keep the Design**:
   - Use the Stitch color scheme and styling
   - Maintain the glassmorphism cards
   - Keep the dark mode aesthetic
   - Material Symbols icons (as they appear in the design)

6. **Add Interactivity**:
   - Add button should open a modal/form to create items
   - Click habit checkboxes to mark complete
   - Click tasks to toggle complete
   - Date clicks show daily view

## Design Code:
<!-- Annotated Mobile Dashboard Refined -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>FocusFlow | Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&amp;family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
                    "surface-tint": "#0053db",
                    "on-secondary-container": "#00714d",
                    "primary-fixed-dim": "#b4c5ff",
                    "on-error-container": "#93000a",
                    "surface-variant": "#d3e4fe",
                    "on-secondary-fixed": "#002113",
                    "primary": "#004ac6",
                    "on-primary-fixed-variant": "#003ea8",
                    "tertiary": "#ad0033",
                    "error-container": "#ffdad6",
                    "on-tertiary-container": "#ffecec",
                    "on-tertiary-fixed-variant": "#92002a",
                    "on-primary-fixed": "#00174b",
                    "inverse-surface": "#213145",
                    "on-tertiary": "#ffffff",
                    "surface-container-high": "#dce9ff",
                    "on-error": "#ffffff",
                    "inverse-on-surface": "#eaf1ff",
                    "surface-dim": "#cbdbf5",
                    "outline-variant": "#c3c6d7",
                    "outline": "#737686",
                    "primary-container": "#2563eb",
                    "inverse-primary": "#b4c5ff",
                    "tertiary-container": "#d22348",
                    "on-tertiary-fixed": "#40000d",
                    "on-secondary": "#ffffff",
                    "surface": "#f8f9ff",
                    "secondary": "#006c49",
                    "on-secondary-fixed-variant": "#005236",
                    "secondary-container": "#6cf8bb",
                    "on-primary": "#ffffff",
                    "surface-container-low": "#eff4ff",
                    "error": "#ba1a1a",
                    "primary-fixed": "#dbe1ff",
                    "secondary-fixed-dim": "#4edea3",
                    "surface-container": "#e5eeff",
                    "on-surface": "#0b1c30",
                    "surface-container-lowest": "#ffffff",
                    "surface-bright": "#f8f9ff",
                    "on-surface-variant": "#434655",
                    "secondary-fixed": "#6ffbbe",
                    "tertiary-fixed-dim": "#ffb2b7",
                    "background": "#f8f9ff",
                    "on-primary-container": "#eeefff",
                    "surface-container-highest": "#d3e4fe",
                    "tertiary-fixed": "#ffdadb",
                    "on-background": "#0b1c30"
            },
            "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
            },
            "spacing": {
                    "xs": "4px",
                    "base": "8px",
                    "md": "24px",
                    "sm": "12px",
                    "gutter": "24px",
                    "margin": "32px",
                    "lg": "40px",
                    "xl": "64px"
            },
            "fontFamily": {
                    "body-md": ["Inter", "sans-serif"],
                    "label-md": ["Inter", "sans-serif"],
                    "body-sm": ["Inter", "sans-serif"],
                    "headline-lg-mobile": ["Inter", "sans-serif"],
                    "headline-lg": ["Inter", "sans-serif"],
                    "headline-xl": ["Inter", "sans-serif"]
            },
            "fontSize": {
                    "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
                    "label-md": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
                    "headline-lg-mobile": ["20px", {"lineHeight": "28px", "fontWeight": "600"}],
                    "headline-lg": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
                    "headline-xl": ["36px", {"lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "700"}]
            }
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
        }
        .glass-card {
            backdrop-filter: blur(16px);
            background: rgba(11, 28, 48, 0.4);
            border: 1px solid rgba(195, 198, 215, 0.08);
        }
        body {
            background-color: #0b1c30;
            overscroll-behavior-y: contain;
        }
        .multi-day-event {
            position: relative;
            z-index: 5;
        }
        .multi-day-event::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 24px;
            transform: translateY(-50%);
            background: rgba(37, 99, 235, 0.2);
            z-index: -1;
        }
        .multi-day-start::before {
            border-top-left-radius: 9999px;
            border-bottom-left-radius: 9999px;
            background: rgba(37, 99, 235, 0.6) !important;
            left: 4px;
        }
        .multi-day-end::before {
            border-top-right-radius: 9999px;
            border-bottom-right-radius: 9999px;
            background: rgba(37, 99, 235, 0.6) !important;
            right: 4px;
        }
        .multi-day-mid::before {
            left: 0;
            right: 0;
        }
    </style>
</head>
<body class="font-body-md text-on-surface bg-on-background selection:bg-primary-container/30">
<!-- Collapsed Side Navigation (Icon Only) -->
<aside class="fixed left-0 top-0 w-14 backdrop-blur-md border-r border-outline-variant/10 flex flex-col items-center py-md gap-lg z-50 bg-on-background h-[calc(100%-64px)]">
<div class="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center mb-base">
<span class="material-symbols-outlined text-on-primary-container" style="font-variation-settings: 'FILL' 1;">bolt</span>
</div>
<div class="flex flex-col gap-md">
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-primary-fixed-dim bg-primary-container/20">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">calendar_today</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">check_circle</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">repeat</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">insights</span>
</button>
</div>
</aside>
<!-- Main Content -->
<main class="ml-14 pb-32 min-h-screen relative z-10 px-gutter">
<!-- Header -->
<header class="pt-lg pb-md">
<div class="flex justify-between items-end">
<div>
<h1 class="text-headline-lg text-on-background font-bold tracking-tight">October 2023</h1>
<p class="text-body-sm text-on-surface-variant/80">Tuesday, Oct 17</p>
</div>
<div class="flex gap-xs"><button class="p-xs text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"><span class="material-symbols-outlined text-[20px]">chevron_left</span></button><button class="p-xs text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"><span class="material-symbols-outlined text-[20px]">chevron_right</span></button></div>
</div>
</header>
<!-- Calendar View -->
<section class="mb-lg">
<div class="glass-card rounded-2xl p-md">
<div class="grid grid-cols-7 text-center mb-sm">
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">S</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">M</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">T</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">W</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">T</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">F</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">S</span>
</div>
<div class="grid grid-cols-7 text-center gap-y-sm"><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant/20 text-body-md">30</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">1</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md relative">2<div class="absolute bottom-2 w-1.5 h-1.5 rounded-full bg-secondary"></div></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">3</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">4</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">5</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md relative">6<div class="absolute bottom-2 flex gap-[2px]"><div class="w-1.5 h-1.5 rounded-full bg-primary-container"></div><div class="w-1.5 h-1.5 rounded-full bg-tertiary"></div></div></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-start">8</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-mid">9</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-end">10</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">11</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">12</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">13</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">14</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">15</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">16</div><div class="h-16 flex flex-col items-center justify-center relative"><span class="w-10 h-10 flex items-center justify-center bg-primary text-white rounded-full font-bold text-body-md shadow-lg shadow-primary/20">17</span></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md bg-secondary-container/10 rounded-lg">18</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">19</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md bg-tertiary-container/10 rounded-lg">20</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">21</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">22</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">23</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">24</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">25</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">26</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">27</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">28</div></div>
</div>
</section>
<!-- Habit Tracker (Refined to match Desktop style) -->
<section>
<div class="flex justify-between items-baseline mb-md">
<h3 class="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em]">Habit Tracking</h3>
<button class="text-primary-fixed-dim text-[10px] font-bold uppercase tracking-wider">Analysis</button>
</div>
<div class="glass-card rounded-2xl p-md space-y-lg"><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span><span class="text-[10px] font-bold text-secondary uppercase tracking-[0.15em]">Hydration</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">2.5L</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 3L</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-secondary text-[20px]">check</span><span class="material-symbols-outlined text-secondary text-[20px]">check</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span></div></div></div><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span><span class="text-[10px] font-bold text-primary-container uppercase tracking-[0.15em]">Deep Work</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">4.0h</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 4h</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span></div></div></div><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span><span class="text-[10px] font-bold text-tertiary uppercase tracking-[0.15em]">Meditation</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">10m</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 15m</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-tertiary text-[20px]">check</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span></div></div></div></div>
</section>
</main>
<!-- Refined Floating Action Button -->
<button class="fixed bottom-24 right-6 w-12 h-12 bg-primary text-on-primary rounded-full shadow-xl z-50 flex items-center justify-center active:scale-90 transition-transform">
<span class="material-symbols-outlined text-[24px]">add</span>
</button>
<!-- Refined Subtle Bottom Navigation -->
<nav class="fixed bottom-0 left-0 w-full h-16 bg-surface-dim/40 backdrop-blur-xl border-t border-outline-variant/5 z-40 flex justify-around items-center px-lg">
<button class="flex flex-col items-center gap-0.5 text-primary-fixed-dim transition-opacity opacity-100">
<span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">calendar_today</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Plan</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Tasks</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">repeat</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Habits</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">settings</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Setup</span>
</button>
</nav>
<script>
    // Subtle interactions
    document.querySelectorAll('.glass-card').forEach(card => {
        card.addEventListener('touchstart', () => {
            card.style.background = 'rgba(11, 28, 48, 0.5)';
        });
        card.addEventListener('touchend', () => {
            card.style.background = 'rgba(11, 28, 48, 0.4)';
        });
    });
</script>
</body></html>

<!-- Refined FocusFlow Dashboard -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>FocusFlow | Productivity Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
                    "surface-tint": "#0053db",
                    "on-secondary-container": "#00714d",
                    "primary-fixed-dim": "#b4c5ff",
                    "on-error-container": "#93000a",
                    "surface-variant": "#d3e4fe",
                    "on-secondary-fixed": "#002113",
                    "primary": "#004ac6",
                    "on-primary-fixed-variant": "#003ea8",
                    "tertiary": "#ad0033",
                    "error-container": "#ffdad6",
                    "on-tertiary-container": "#ffecec",
                    "on-tertiary-fixed-variant": "#92002a",
                    "on-primary-fixed": "#00174b",
                    "inverse-surface": "#213145",
                    "on-tertiary": "#ffffff",
                    "surface-container-high": "#dce9ff",
                    "on-error": "#ffffff",
                    "inverse-on-surface": "#eaf1ff",
                    "surface-dim": "#cbdbf5",
                    "outline-variant": "#c3c6d7",
                    "outline": "#737686",
                    "primary-container": "#2563eb",
                    "inverse-primary": "#b4c5ff",
                    "tertiary-container": "#d22348",
                    "on-tertiary-fixed": "#40000d",
                    "on-secondary": "#ffffff",
                    "surface": "#f8f9ff",
                    "secondary": "#006c49",
                    "on-secondary-fixed-variant": "#005236",
                    "secondary-container": "#6cf8bb",
                    "on-primary": "#ffffff",
                    "surface-container-low": "#eff4ff",
                    "error": "#ba1a1a",
                    "primary-fixed": "#dbe1ff",
                    "secondary-fixed-dim": "#4edea3",
                    "surface-container": "#e5eeff",
                    "on-surface": "#0b1c30",
                    "surface-container-lowest": "#ffffff",
                    "surface-bright": "#f8f9ff",
                    "on-surface-variant": "#434655",
                    "secondary-fixed": "#6ffbbe",
                    "tertiary-fixed-dim": "#ffb2b7",
                    "background": "#f8f9ff",
                    "on-primary-container": "#eeefff",
                    "surface-container-highest": "#d3e4fe",
                    "tertiary-fixed": "#ffdadb",
                    "on-background": "#0b1c30",
                    "deep-navy": "#0a121e"
            },
            "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
            },
            "spacing": {
                    "xs": "4px",
                    "base": "8px",
                    "md": "24px",
                    "sm": "12px",
                    "gutter": "24px",
                    "margin": "32px",
                    "lg": "40px",
                    "xl": "64px"
            },
            "fontFamily": {
                    "body-md": ["Inter"],
                    "label-md": ["Inter"],
                    "body-sm": ["Inter"],
                    "headline-lg-mobile": ["Inter"],
                    "headline-lg": ["Inter"],
                    "headline-xl": ["Inter"]
            },
            "fontSize": {
                    "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
                    "label-md": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
                    "headline-lg-mobile": ["20px", {"lineHeight": "28px", "fontWeight": "600"}],
                    "headline-lg": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
                    "headline-xl": ["36px", {"lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "700"}]
            }
          },
        },
      }
    </script>
<style>
        body {
            background-color: #0b1c30;
            font-family: 'Inter', sans-serif;
            color: #eaf1ff;
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            height: calc(100vh - 120px);
        }
        .calendar-cell {
            border-right: 1px solid rgba(0, 0, 0, 0.05);
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            transition: background-color 0.2s;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .calendar-cell:hover {
            background: rgba(0, 0, 0, 0.02);
        }
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
    </style>
</head>
<body class="overflow-hidden bg-on-background">
<!-- Top Navigation (Shell Implementation) -->
<header class="bg-deep-navy w-full h-16 fixed top-0 left-0 z-40 border-b border-outline-variant/10 shadow-sm flex justify-between items-center px-margin w-full max-w-[1440px] mx-auto">
<div class="flex items-center gap-md ml-xl">
<span class="font-headline-lg text-headline-lg font-bold text-primary-fixed-dim">Albas</span>
<div class="hidden md:flex gap-sm ml-xl">
<span class="font-body-md text-body-md text-primary-fixed-dim font-bold border-b-2 border-primary pb-1 cursor-pointer">Calendar</span>
<span class="font-body-md text-body-md text-outline-variant font-medium hover:bg-white/5 transition-colors cursor-pointer active:scale-95 px-2 rounded">Projects</span>
<span class="font-body-md text-body-md text-outline-variant font-medium hover:bg-white/5 transition-colors cursor-pointer active:scale-95 px-2 rounded">Analytics</span>
</div>
</div>
<div class="flex items-center gap-md"></div>
</header>
<div class="flex pt-16 h-screen">
<!-- Left Sidebar (SideNavBar Implementation) - Updated to Deep Navy -->
<aside class="fixed left-0 top-0 h-full w-16 z-50 bg-deep-navy border-r border-outline-variant/10 flex flex-col p-base space-y-xs items-center pt-2">
<div class="px-md py-md mb-md hidden">
<h1 class="font-headline-lg text-headline-lg font-bold text-primary">FocusFlow</h1>
<p class="font-label-md text-label-md text-on-surface-variant">Productivity Suite</p>
</div>
<nav class="space-y-xs mt-4">
<div class="bg-primary text-white rounded-lg font-semibold flex items-center gap-sm px-md py-sm cursor-pointer hover:translate-x-1 duration-200 shadow-lg">
<span class="material-symbols-outlined">calendar_today</span>
<span class="font-label-md text-label-md hidden">Calendar</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">check_circle</span>
<span class="font-label-md text-label-md hidden">Tasks</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">repeat</span>
<span class="font-label-md text-label-md hidden">Habits</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">settings</span>
<span class="font-label-md text-label-md hidden">Settings</span>
</div>
</nav>
</aside>
<!-- Main Content (Central Calendar Workspace) -->
<main class="ml-16 mr-[280px] flex-1 bg-on-background p-md overflow-hidden">
<div class="max-w-[1440px] mx-auto h-full flex flex-col">
<!-- Calendar Header -->
<div class="flex items-center justify-between mb-md">
<div class="flex items-center gap-md">
<h2 class="font-headline-xl text-headline-xl text-on-primary">October 2024</h2>
<div class="flex bg-white/10 rounded-lg p-xs">
<button class="p-xs hover:bg-white/20 rounded transition-colors">
<span class="material-symbols-outlined text-outline-variant">chevron_left</span>
</button>
<button class="px-sm text-label-md font-label-md text-on-primary">Today</button>
<button class="p-xs hover:bg-white/20 rounded transition-colors">
<span class="material-symbols-outlined text-outline-variant">chevron_right</span>
</button>
</div>
</div>
<div class="flex items-center gap-sm bg-white/10 p-xs rounded-lg">
<button class="px-md py-xs rounded bg-surface-bright text-primary font-semibold text-label-md shadow-sm">Month</button>
<button class="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">Week</button>
<button class="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">Day</button>
</div>
</div>
<!-- Calendar Content - High Contrast Light Background -->
<div class="flex-1 bg-surface-bright rounded-xl border border-outline-variant/30 overflow-hidden shadow-2xl">
<!-- Weekdays Row -->
<div class="grid grid-cols-7 bg-surface-container/50 border-b border-outline-variant/30">
<div class="py-sm text-center font-label-md text-label-md text-outline">MON</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">TUE</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">WED</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">THU</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">FRI</div>
<div class="py-sm text-center font-label-md text-label-md text-on-surface font-bold">SAT</div>
<div class="py-sm text-center font-label-md text-label-md text-on-surface font-bold">SUN</div>
</div>
<!-- Days Grid -->
<div class="calendar-grid scrollbar-hide overflow-y-auto bg-white text-on-surface">
<div class="calendar-cell p-sm opacity-40"><div>30</div></div>
<div class="calendar-cell p-sm"><div>1</div></div>
<div class="calendar-cell p-sm">
<div>2</div>
<div class="mt-auto p-xs bg-secondary/10 border-l-4 border-secondary rounded text-[10px] text-on-secondary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">09:00 AM</span>
            Team Sync
        </div>
</div>
<div class="calendar-cell p-sm"><div>3</div></div>
<div class="calendar-cell p-sm">
<div>4</div>
<div class="mt-auto p-xs bg-primary/10 border-l-4 border-primary rounded text-[10px] text-on-primary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">02:00 PM</span>
            Project Review
        </div>
</div>
<div class="calendar-cell p-sm font-bold"><div>5</div></div>
<div class="calendar-cell p-sm font-bold"><div>6</div></div>
<div class="calendar-cell p-sm"><div>7</div></div>
<div class="calendar-cell p-sm"><div>8</div></div>
<div class="calendar-cell p-sm">
<div>9</div>
<div class="mt-auto p-xs bg-tertiary/10 border-l-4 border-tertiary rounded text-[10px] text-on-tertiary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">08:00 AM</span>
            Meditation
        </div>
</div>
<div class="calendar-cell p-sm"><div>10</div></div>
<div class="calendar-cell p-sm"><div>11</div></div>
<div class="calendar-cell p-sm font-bold"><div>12</div></div>
<div class="calendar-cell p-sm font-bold"><div>13</div></div>
<div class="calendar-cell p-sm"><div>14</div></div>
<div class="calendar-cell p-sm bg-primary-container/5">
<div>15</div>
<div class="mt-auto p-xs bg-primary/20 border-l-4 border-primary rounded text-[10px] text-primary font-bold">Today</div>
</div>
<!-- Multi-day Event Row Start -->
<div class="calendar-cell p-sm bg-secondary/10 relative border-t-2 border-on-surface border-b-2">
<div class="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-on-surface"></div>
<div class="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-on-surface"></div>
<div class="text-[10px] font-bold text-on-secondary-fixed-variant bg-white px-1 absolute top-[-7px] left-2">Product Launch</div>
<div>16</div>
</div>
<div class="calendar-cell p-sm bg-secondary/10 border-t-2 border-on-surface border-b-2">
<div>17</div>
</div>
<div class="calendar-cell p-sm bg-secondary/10 relative border-t-2 border-on-surface border-b-2">
<div class="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-on-surface"></div>
<div class="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-on-surface"></div>
<div>18</div>
</div>
<!-- Multi-day Event Row End -->
<div class="calendar-cell p-sm font-bold"><div>19</div></div>
<div class="calendar-cell p-sm font-bold"><div>20</div></div>
<div class="calendar-cell p-sm"><div>21</div></div>
<div class="calendar-cell p-sm"><div>22</div></div>
<div class="calendar-cell p-sm"><div>23</div></div>
<div class="calendar-cell p-sm"><div>24</div></div>
<div class="calendar-cell p-sm"><div>25</div></div>
<div class="calendar-cell p-sm font-bold"><div>26</div></div>
<div class="calendar-cell p-sm font-bold"><div>27</div></div>
<div class="calendar-cell p-sm"><div>28</div></div>
<div class="calendar-cell p-sm"><div>29</div></div>
<div class="calendar-cell p-sm"><div>30</div></div>
<div class="calendar-cell p-sm"><div>31</div></div>
<div class="calendar-cell p-sm opacity-40"><div>1</div></div>
<div class="calendar-cell p-sm opacity-40 font-bold"><div>2</div></div>
<div class="calendar-cell p-sm opacity-40 font-bold"><div>3</div></div>
</div>
</div>
</div>
</main>
<!-- Right Utility Sidebar - Updated to Deep Navy -->
<aside class="fixed right-0 top-16 h-[calc(100%-64px)] w-[280px] z-30 bg-deep-navy border-l border-outline-variant/10 flex flex-col py-md px-sm">
<!-- Habit Tracker Section -->
<div class="mb-lg px-xs">
<div class="flex items-center justify-between mb-md">
<h3 class="font-label-md text-label-md text-outline-variant uppercase tracking-wider">Habit Tracker</h3>
<span class="material-symbols-outlined text-outline-variant text-[18px] cursor-pointer">more_horiz</span>
</div>
<div class="space-y-md">
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-secondary opacity-70">Deep Work</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-tertiary opacity-70">Meditation</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-primary opacity-70">Reading</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
</div>
</div>
<!-- To-Do List -->
<div class="px-xs">
<h3 class="font-label-md text-label-md text-outline-variant mb-md uppercase tracking-wider">Tasks</h3>
<div class="space-y-xs">
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-primary-fixed-dim rounded flex items-center justify-center">
<span class="material-symbols-outlined text-primary-fixed-dim text-[14px] font-bold opacity-0 group-hover:opacity-100">check</span>
</div>
<div>
<p class="font-body-sm text-body-sm text-inverse-on-surface">Finalize Q4 roadmap</p>
<p class="font-label-md text-[10px] text-outline-variant">FocusFlow Project</p>
</div>
</div>
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-outline-variant/30 rounded flex items-center justify-center"></div>
<div>
<p class="font-body-sm text-body-sm text-inverse-on-surface">Client meeting prep</p>
<p class="font-label-md text-[10px] text-outline-variant">Marketing</p>
</div>
</div>
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-primary rounded flex items-center justify-center bg-primary">
<span class="material-symbols-outlined text-on-primary text-[14px] font-bold">check</span>
</div>
<div>
<p class="font-body-sm text-body-sm text-outline-variant line-through opacity-60">Inbox Zero</p>
<p class="font-label-md text-[10px] text-outline-variant">General</p>
</div>
</div>
</div>
</div>
</aside>
</div>
<!-- Floating Action Button -->
<button class="fixed bottom-md right-[300px] w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-50">
<span class="material-symbols-outlined text-[32px]">add</span>
</button>
<script>
    // Simple check functionality toggle (visual only)
    document.querySelectorAll('.group .h-5').forEach(checkbox => {
        checkbox.addEventListener('click', function(e) {
            e.stopPropagation();
            const icon = this.querySelector('.material-symbols-outlined');
            if (this.classList.contains('bg-primary')) {
                this.classList.remove('bg-primary');
                if (icon) icon.classList.add('opacity-0');
                this.nextElementSibling.querySelector('p').classList.remove('line-through', 'opacity-60');
            } else {
                this.classList.add('bg-primary');
                if (icon) icon.classList.remove('opacity-0');
                this.nextElementSibling.querySelector('p').classList.add('line-through', 'opacity-60');
            }
        });
    });
</script>
</body></html>

Please structure this as a properly organized React project with clear component separation, prop interfaces, and shared state management.

This should be made with Tauri, React, Tailwind, TSX, 
