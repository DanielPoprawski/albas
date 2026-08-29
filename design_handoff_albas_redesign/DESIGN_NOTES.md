# Albas UI Redesign — Design Notes

## Project Overview
Modern light-theme redesign of Albas, a productivity suite (calendar, to-do, habits, settings, admin). Aesthetic: sharp square edges (no border-radius anywhere), white surfaces, a single purple accent, on `Outfit` (body) + `Sora` (headings/logo) fonts.

## Visual System
- **Edges**: every corner is a hard 90°. No `border-radius` on cards, buttons, inputs, avatars, or chips.
- **Color**: white surfaces (`#ffffff`) on a very light gray page background (`#f8fafb`). Single accent purple `#a855f7` (hover/darker `#9333ea`) for active states, links, primary buttons, and category branding. Borders `#e5e7eb`. Body text `#1a202c`, muted text `#9ca3af`/`#6b7280`. Status/category colors (amber, green, blue, pink, teal) are used only as small accents (dots, pills, tags), never as large fills.
- **Type**: `Outfit` (400–700) for body/UI, `Sora` (600–700) for headings, the logo wordmark, and card/page titles.
- **Admin Console** now uses the same light/white/purple system as the rest of the app (previously dark — recolored for consistency); monospace `JetBrains Mono` is kept only for IDs and the SQL console.

## Desktop App Shell (Dashboard, To-Do, Settings, Admin Console)
- **Left sidebar** (200–240px, white, right border) is the shared shell across every desktop page:
  - **Logo row**: a small square purple mark ("A", `.logo-mark`) to the left of the "Albas" wordmark (Sora).
  - **Menu section**: Dashboard, To-Do, Habits, Settings — each a real `<a>` link to its sibling page, with a 15px line-icon to the left of the label (grid = Dashboard, checklist = To-Do, target = Habits, gear = Settings). Active page is purple + bold; others are muted gray with a hover tint.
  - **Second section is page-specific**, directly below Menu: calendar Categories on the Dashboard, task Categories on To-Do, nothing extra on Settings.
- **Bottom taskbar** — present on every desktop view (Dashboard, To-Do, Settings, Admin Console), 32px, white, top border, matches the reference screenshot exactly:
  - Left: version tag (`v1.9.0`, bold).
  - Right: sync status (`↻ 11:12 PM · just now`) → divider → avatar chip + name (`DP` mark + "Daniel P").
  - Markup/CSS is identical across pages (`.bottom-bar`, `.bar-version`, `.bar-right`, `.bar-sync`, `.bar-divider`, `.bar-user`) — copy verbatim when adding a new desktop page.

## Splash & Auth (Albas Splash & Auth.dc.html) — reference quality, do not restyle
This screen is considered finished and correct; treat it as the tone-setting reference for the rest of the app.
- Full-bleed centered splash: soft two-tone diagonal page gradient (`#f8fafb` → `#f0f4f8`), a large square purple gradient logo mark, Sora wordmark "Albas" at 42px, a gray subtitle/description, then a stacked button pair (solid purple primary "Sign In", outlined purple secondary "Create Account"), and a muted "Use Offline" link below a hairline divider.
- Auth screens (Sign In / Create Account / Offline) reuse one centered white card (`.auth-card`, sharp corners, soft large shadow) with a Sora title, gray subtitle, uppercase micro-labels above thick 2px-bordered inputs (purple focus ring), a tinted purple callout for passkey messaging, a primary+text button row, and a footer link to switch flows.
- The Sign In card now states the sign-in method count under its subtitle ("4 ways to sign in · Passkey, Password, OAuth, 2FA") so users know their options before picking one.
- Screen switching is a simple show/hide (`.screen.active`) driven by `showScreen()` — no router needed since it's a single self-contained file.

## Completed Screens
1. **Albas Splash & Auth.dc.html** — Splash + Sign In/Register/Offline; reference-quality, see above.
2. **Albas To-Do.dc.html** — Unified sidebar (Menu + collapsible Categories card) + bottom taskbar. Main list order: **All** (aggregate, top) → one section per active category (color-coded header) → **Completed** (bottom, always last). Sort within every section: **Important → Due Date → Time Added**. Each row shows the ★/☆ star (importance toggle) to the **left** of the checkbox, then title/meta. "Add a task" is a popped-out card (margin + padding + shadow), not an inline bar. Sidebar Categories block is a bordered card with a purple color-coded header row that collapses/expands (chevron toggle); "All" and "Completed" are checkbox rows inside it alongside the 5 categories (Work, Personal, Shopping, Health, Finance), each toggling that category's visibility everywhere.
3. **Albas Settings.dc.html** — Unified sidebar (no more internal Profile/Account/Appearance tab nav) + bottom taskbar. All settings render as cards in one 2-column desktop grid (1 column on mobile, `@media 768px`) so nothing is hidden behind tabs: Profile (avatar + display name, no bio field), Session (Sync Now + Log Out), Account & Sign-in (single table — Username/Email rows plus every sign-in method with a color-coded Type pill: OAuth/Passkey/Biometric/Password/2FA), Theme, Font, Text Size.
4. **Albas Mobile Dashboard.dc.html** — Mobile-optimized dashboard view.
5. **Albas Desktop Dashboard.dc.html** — Calendar + habits + tasks; now on the shared sidebar shell and bottom taskbar described above.
6. **Albas Admin Console.dc.html** — Recolored from a dark theme to the app's light/white/purple theme (sharp edges kept); added the shared logo mark and bottom taskbar. User table's Login Method column is a good place to also surface method counts if the admin view needs it later.

## Key Patterns
- Flex/grid layouts with `gap` (not inline spacing).
- Inline styles only (no stylesheets except the `@import` font line, keyframes, and body/shell resets in `<helmet><style>`).
- Template holes are dotted paths only (`{{ path }}`) — **never** a ternary or expression in a hole. Precompute display strings/classes in `renderVals()` (e.g. `task.checkboxClass`, `task.checkGlyph`, `task.starClass`, `task.starGlyph`, `theme.activeClass`) and reference the plain field in the template.
- Section conditionals use flags computed in `renderVals()`: `showProfile: activeSection === 'profile'` → `<sc-if value="{{ showProfile }}">`.
- Collapsible sections (To-Do categories card, To-Do task groups) track expanded/checked state in component state, toggled via click handlers reading `data-*` attributes.
- Sidebar navigation between pages uses real `<a href="./Albas%20X.dc.html">` links, not JS routing.

## Next Steps
- Add a matching sidebar + bottom taskbar to Mobile Dashboard's desktop-equivalent views if one is ever needed (mobile itself stays single-column/native-nav).
- Consider surfacing sign-in method count in Settings' Account & Sign-in card header (e.g. "5 methods") to mirror the login screen's new count line.
- Continue polishing hover/pressed states and responsive behavior across all screens.
