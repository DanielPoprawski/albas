# Package 00 — Design tokens & primitives

**Design reference:** `designs/(read any two desktop files)`

**Wave 1 — must merge before anything else starts.**

## Goal
Establish the redesign's token layer and the primitive components every other package consumes.

## Files you own
- `src/colors.ts`
- `src/App.css` (token block, `@font-face`/`@theme`, base resets)
- `src/components/ui/` (new — primitives)

## Tokens to define
Colors: bg `#f8fafb`, surface `#ffffff`, border `#e5e7eb`, subtle `#f3f4f6`, accent `#a855f7`, accentHover `#9333ea`, accentDeep `#7e22ce`, accentTint `#faf5ff`, text `#1a202c`, textSecondary `#6b7280`, textMuted `#9ca3af`.

Category accents (small marks only): amber, green, blue, pink, teal — take the exact hexes from the To-Do and Dashboard design files.

Type: `--font-body: 'Outfit'`, `--font-heading: 'Sora'`, `--font-mono: 'JetBrains Mono'`. Load 400/500/600/700 for Outfit, 400/600/700 for Sora.

Spacing scale: 4 6 8 10 12 14 16 18 20 24.

Radius: **0**. Remove every existing `border-radius` rule from `App.css` — that cleanup is part of this package.

Shadows: card `0 1px 3px rgba(15,23,42,.06)`; modal `0 30px 70px rgba(15,23,42,.22)`.

## Primitives to build
- `Button` — variants `primary` (solid `#a855f7`, white text, hover `#9333ea`), `secondary` (white, 1px `#a855f7` border, purple text, hover bg `#faf5ff`), `ghost` (transparent, `#6b7280`, hover bg `#f3f4f6`). Outfit 600, 12px, `padding: 8px 12px`, square.
- `Input` — square, 2px `#e5e7eb` border, purple border on focus. Uppercase 10px micro-label above.
- `Card` — white, 1px `#e5e7eb`, square, card shadow.
- `Tag` / `Pill` — 10px/700/uppercase, `letter-spacing: .5px`, `padding: 3px 8px`, tinted background from a category accent.
- `Checkbox`, `Segmented` (row of square options, active = purple).

## Global states
`:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }` on all interactive elements. Disabled = 45% opacity. `::selection` uses an accent tint.

## Done when
The primitives render correctly in isolation and no non-zero `border-radius` remains anywhere in `src/`.
