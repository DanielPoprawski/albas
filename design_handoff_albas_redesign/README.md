# Handoff: Albas UI Redesign — Modern Light Theme

## Overview
A full light-theme redesign of **Albas**, a local-first productivity suite (calendar, to-do, habits, settings, admin console). Repo: `DanielPoprawski/albas`, branch `main`, app source under `src/`, sync server under `sync-server/`.

The redesign replaces the current look with: hard 90 degree corners everywhere, white surfaces on a near-white page, a single purple accent, and an Outfit/Sora type pairing. Nine screens are designed and included in `designs/`.

## About the Design Files
The files in `designs/` are **design references authored in HTML** — prototypes showing intended look and behavior. They are **not** production code and must not be copied into the app verbatim.

The target codebase is a **React + TypeScript + Vite** app (`src/components/*.tsx`, styling in `src/App.css`, tokens in `src/colors.ts`). Recreate these designs there using the app's existing component structure, state, and data layer. Keep the app's real data flow; only the presentation layer changes.

Each design file opens directly in a browser. Open it side-by-side with the implementation and match it.

## Fidelity
**High-fidelity.** Colors, type, spacing, and interaction states are final. Match them pixel-for-pixel. Where a value is not stated in this README, read it off the corresponding file in `designs/` — those files are the source of truth for exact numbers.

## Design Tokens

### Color
| Role | Value |
| --- | --- |
| Page background | `#f8fafb` |
| Surface / card | `#ffffff` |
| Border (hairline) | `#e5e7eb` |
| Subtle fill / hover | `#f3f4f6` |
| Accent | `#a855f7` |
| Accent hover / pressed | `#9333ea` |
| Accent deep (gradient end) | `#7e22ce` |
| Accent tint (bg wash) | `#faf5ff` |
| Text primary | `#1a202c` |
| Text secondary | `#6b7280` |
| Text muted | `#9ca3af` |
| Logo mark gradient | `linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)` |
| Splash page gradient | `#f8fafb` to `#f0f4f8` (diagonal) |

Category / status accents (dots, pills, tags **only** — never large fills): amber, green, blue, pink, teal. Exact hexes per screen live in the design files.

### Radius
**`0` everywhere.** No border-radius on cards, buttons, inputs, avatars, chips, modals, or the logo mark. This is the single most important rule of the redesign.

### Type
- Body / UI: **Outfit**, weights 400 / 500 / 600 / 700
- Headings, logo wordmark, card + page titles, numerals in stats: **Sora**, weights 600 / 700
- IDs and the SQL console (Admin only): **JetBrains Mono**
- Scale in use: 10px (micro-label, uppercase, `letter-spacing: .5px`), 11px (bar text, meta), 12px (sidebar item, body meta), 14px (card title), 16px (logo, modal title), 18px (page h1, modal input), 26px (stat value), 42px (splash wordmark)

### Spacing
4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24px. Layouts use flex/grid with `gap` — never margin chains.

### Shadow
- Card lift: `0 1px 3px rgba(15, 23, 42, .06)`
- Modal: `0 30px 70px rgba(15, 23, 42, .22)`
- Auth card: soft large shadow (see the Splash and Auth design file)

### Motion
- Standard transition: `.15s`-`.2s ease` on color/background/border
- Modal entrance: `.22s cubic-bezier(.2,.8,.3,1)`
- Add Modal height change is a **spring**, not a transition (see package 05)

## Shared Chrome (build once, use on every desktop screen)

### Left sidebar
200px wide, white, `border-right: 1px solid #e5e7eb`, `padding: 24px 16px`, flex column, `gap: 24px`, scrollable.
- **Logo row** (16px Sora 700): a 20x20 square gradient mark showing "A" in white Sora, then the wordmark "Albas".
- **Menu section**: section title (10px/700/uppercase/`#9ca3af`/`letter-spacing: .5px`) then four items — Dashboard, To-Do, Habits, Settings. Each item is 12px `#6b7280`, `padding: 6px 8px`, `gap: 10px`, with a 15px stroke-1.8 line icon (grid / checklist / target / gear). Hover: `background #f3f4f6`, text `#1a202c`. Active: purple + bold.
- **Second section is page-specific**, directly below Menu: calendar Categories on Dashboard, task Categories on To-Do, nothing on Habits/Settings.

### Bottom taskbar
32px tall, white, `border-top: 1px solid #e5e7eb`, `padding: 0 16px`, 11px `#6b7280`, space-between.
- Left: version tag `v1.9.0` (600, `#1a202c`).
- Right: sync status (refresh glyph, `11:12 PM · just now`), then a 1x14px `#e5e7eb` divider, then a 20x20 purple `DP` avatar square + "Daniel P".

Markup and CSS are **identical** on every desktop page. Implement once as a shell component.

## Screens
Nine screens, each with its own work package in `packages/`. Full spec per screen lives in that package file; the visual truth lives in the matching file in `designs/`.

| # | Screen | Design file | Package |
| --- | --- | --- | --- |
| 0 | Tokens + primitives | (all) | `packages/00-foundation.md` |
| 1 | App shell (sidebar + taskbar) | any desktop file | `packages/01-app-shell.md` |
| 2 | Desktop Dashboard | `Albas Desktop Dashboard.dc.html` | `packages/02-dashboard.md` |
| 3 | To-Do | `Albas To-Do.dc.html` | `packages/03-todo.md` |
| 4 | Habits | `Albas Habits.dc.html` | `packages/04-habits.md` |
| 5 | Add Modal | `Albas Add Modal.dc.html` | `packages/05-add-modal.md` |
| 6 | Settings | `Albas Settings.dc.html` | `packages/06-settings.md` |
| 7 | Splash & Auth | `Albas Splash and Auth.dc.html` | `packages/07-auth.md` |
| 8 | Admin Console | `Albas Admin Console.dc.html` | `packages/08-admin.md` |
| 9 | Mobile Dashboard | `Albas Mobile Dashboard.dc.html` | `packages/09-mobile.md` |

## Interactions & Behavior
- Sidebar nav switches routes/views; active item is purple + bold.
- Every interactive element needs hover **and** pressed states from the accent (`#a855f7` to `#9333ea`), plus `:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }`. Never leave a browser-default focus ring.
- Disabled controls: 45% opacity, `cursor: not-allowed`.
- Responsive breakpoint: `@media (max-width: 768px)` — shell stacks to a column, 2-col grids become 1-col.

## State Management
No new global state is introduced by the redesign. Local component state needed:
- To-Do: category visibility map, per-section collapsed flag, task importance/completion.
- Habits: per-habit done-today flag.
- Add Modal: `type` (event/task/habit), `title`, per-type enabled-field map, `allDay`, `repeat`, measured height.
- Settings: theme / font / text-size selections.
- Auth: current screen (splash / signin / register / offline).

Data continues to come from the app's existing store and sync layer.

## Assets
No new binary assets. The logo mark is a CSS gradient square with a Sora "A". All icons are inline 15-24px SVG at `stroke-width: 1.8`-`2.2`, `fill: none`, `stroke: currentColor` — copy them from the design files. Fonts load from Google Fonts (Outfit, Sora, JetBrains Mono); prefer self-hosting via the app's existing `@font-face` setup in `src/App.css`.

## Files
```
designs/          the nine HTML design references (+ support.js they load)
packages/         one work package per agent (start here)
screenshots/      PNG reference images of each screen (for quick visual reference)
assets/           logo SVGs — albas-mark-glyph.svg, albas-mark-tile.svg, albas-lockup.svg
ORCHESTRATION.md  how to run several agents in parallel
DESIGN_NOTES.md   the original design rationale
```

Start with `ORCHESTRATION.md`.
