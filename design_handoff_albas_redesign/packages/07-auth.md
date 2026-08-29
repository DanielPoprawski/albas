# Package 07 — Splash & Auth

**Design reference:** `designs/Albas Splash and Auth.dc.html`

**Wave 2 — parallel.** This screen is reference-quality in the design file. Match it exactly; do not reinterpret it.

## Files you own
The splash / sign-in / register / offline entry components and their styles.

## Splash
Full-bleed centered, soft two-tone diagonal gradient `#f8fafb` to `#f0f4f8`. Large square purple gradient logo mark, "Albas" wordmark in Sora at **42px**, gray subtitle, then a stacked button pair — solid purple **Sign In**, outlined purple **Create Account** — and a muted **Use Offline** link below a hairline divider.

## Auth cards
One centered white card (square corners, soft large shadow) reused by all three flows:
- Sora title, gray subtitle
- Uppercase 10px micro-labels above **2px-bordered** inputs with a purple focus ring
- A tinted purple callout for passkey messaging
- A primary + text button row
- A footer link switching flows

The Sign In card states the method count under its subtitle: "4 ways to sign in · Passkey, Password, OAuth, 2FA".

## Behavior
Simple show/hide between screens — no router needed for this entry flow. Preserve the app's existing passkey/password auth calls.

## Done when
Splash and all three cards match the design file, and real auth still works.
