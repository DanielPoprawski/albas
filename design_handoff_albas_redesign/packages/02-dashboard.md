# Package 02 — Desktop Dashboard

**Design reference:** `designs/Albas Desktop Dashboard.dc.html`

**Wave 2 — parallel.**

## Files you own
`src/components/Calendar.tsx`, `src/components/RightPanel.tsx`, the desktop branch of `src/components/HomeView.tsx`, and their styles.

## Scope
Rebuild the dashboard inside the package-01 shell: the calendar grid as the main column, the right panel (habits + tasks) beside it. The sidebar's page-specific section is **calendar Categories** — color-coded rows, each with a visibility checkbox.

Match grid line weights, day-cell padding, event chip styling (square, category-tinted), today's marker, and the right panel's card rhythm to the design file. Category colors appear only as dots, chips and left marks — never as a filled cell.

## Notes
- Keep the existing calendar data source and date logic; change presentation only.
- The add button opens the Add Modal (package 05) — expose an `onAdd` callback prop and leave it stubbed; package 05 wires it.

## Done when
The dashboard matches the design file side-by-side at 1440px and stacks cleanly at 768px.
