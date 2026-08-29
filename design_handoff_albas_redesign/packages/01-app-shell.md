# Package 01 — App shell — sidebar + bottom taskbar

**Design reference:** `designs/Albas Desktop Dashboard.dc.html`

**Wave 1 — merge together with package 00 before Wave 2 starts.**

## Goal
One shell component wrapping every desktop screen: left sidebar, main content slot, bottom taskbar.

## Files you own
- `src/components/AppShell.tsx`
- the shell's styles in `src/App.css`

## Layout
Outer: `display: flex; flex-direction: column; height: 100vh`. Inside it a `flex: 1` row of `[sidebar][content]`, then the 32px taskbar. Content column: `flex: 1; background: white; overflow: hidden`.

## Sidebar (200px)
White, `border-right: 1px solid #e5e7eb`, `padding: 24px 16px`, flex column, `gap: 24px`, `overflow-y: auto`, `flex-shrink: 0`.

**Logo row**: 16px Sora 700 `#1a202c`, flex, `gap: 8px`. Mark: 20x20 square, `linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)`, white centered Sora "A". Wordmark: "Albas".

**Section title**: 10px, 700, `#9ca3af`, uppercase, `letter-spacing: .5px`, `margin-bottom: 4px`.

**Nav items**: `display: flex; align-items: center; gap: 10px; padding: 6px 8px; font-size: 12px; color: #6b7280; transition: all .2s`, real links. 15px inline SVG icon, `stroke-width: 1.8`, `fill: none`, `stroke: currentColor` — grid (Dashboard), checklist (To-Do), concentric circles r=8/r=3 (Habits), gear (Settings). Hover: `background: #f3f4f6; color: #1a202c`. Active: purple, bold.

**Slot** below Menu for a page-specific second section (Categories cards etc.).

## Bottom taskbar (32px)
White, `border-top: 1px solid #e5e7eb`, `padding: 0 16px`, 11px `#6b7280`, space-between.
- Left: `v1.9.0`, weight 600, `#1a202c`.
- Right, `gap: 12px`: sync status (refresh glyph + `11:12 PM · just now`); a 1x14px `#e5e7eb` divider; user block — 20x20 `#a855f7` square with white 10px/600 "DP", then "Daniel P".

## Responsive
`@media (max-width: 768px)` — shell and content stack to a column.

## Done when
All four desktop routes render inside the shell with the correct active state and an identical taskbar.
