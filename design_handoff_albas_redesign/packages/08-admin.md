# Package 08 — Admin Console

**Design reference:** `designs/Albas Admin Console.dc.html`

**Wave 2 — parallel.**

## Files you own
The admin console view and its styles. Read `sync-server/src/main.rs` for the real schema and admin endpoints.

## Scope
The console was dark; it is now on the app's light/white/purple system with square edges, the shared logo mark, and the shared bottom taskbar. Make sure no dark fill survives — `#0f1419` previously lingered on the panel area; the panel background is white.

Content is driven by the **real** sync-server schema: accounts, tokens, passkeys, shares, invites, rows. No fabricated users or tables.

`JetBrains Mono` is kept **only** for IDs and the SQL console; everything else is Outfit/Sora.

Table styling: themed header row, hairline `#e5e7eb` row rules, Type pills in the Login Method column (same pill styling as Settings — surfacing method counts there is welcome).

## Done when
Every table maps to a real endpoint, and no dark-theme remnants remain.
