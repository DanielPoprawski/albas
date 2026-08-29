# Package 06 — Settings

**Design reference:** `designs/Albas Settings.dc.html`

**Wave 2 — parallel.**

## Files you own
The settings view component(s) and their styles.

## Structure
No internal tab navigation — the old Profile/Account/Appearance tabs are **removed**. Everything renders as cards in one 2-column grid (1 column under 768px), so nothing is hidden:

1. **Profile** — avatar + display name. No bio field.
2. **Session** — Sync Now, Log Out.
3. **Account & Sign-in** — a single table: Username and Email rows, plus one row per sign-in method with a color-coded Type pill (OAuth / Passkey / Biometric / Password / 2FA). Surface a method count in the card header ("5 methods").
4. **Theme**
5. **Font**
6. **Text Size**

The sidebar has no page-specific second section on this page.

## Done when
Every setting is reachable without tabs and the grid collapses to one column at 768px.
