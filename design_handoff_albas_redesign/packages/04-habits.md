# Package 04 — Habits

**Design reference:** `designs/Albas Habits.dc.html`

**Wave 2 — parallel.**

## Files you own
The habits view component(s) and their styles.

## Layout
Header (`padding: 16px 24px`, bottom border): 18px Sora 700 h1 + 12px `#9ca3af` subtitle. Body: `padding: 24px`, scrollable.

**Stats row** — flex, `gap: 16px`. Each stat card: `flex: 1`, white, 1px `#e5e7eb`, `padding: 16px 20px`; value 26px Sora 700; label 12px `#6b7280`, `margin-top: 4px`.

**Week chart card** — white, 1px border, `padding: 20px`, `margin-bottom: 24px`. Title 12px/700/uppercase/`#9ca3af`. Bars: flex, `align-items: flex-end`, `gap: 12px`, `height: 110px`; fill `#a855f7`, `min-height: 4px`; labels 11px `#9ca3af`.

**Habits grid** — `grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px`. Card: white, 1px border, `padding: 18px`, flex column `gap: 14px`, hover `border-color: #a855f7`.
- Top row: 10x10 color dot, 14px Sora 600 name, cadence tag (10px/700/uppercase, `padding: 3px 8px`).
- Stats row: `gap: 20px`; numbers 18px Sora 700, labels 10px `#9ca3af`.
- Reminder line: 11px `#6b7280` with a small icon.
- Heatmap: `grid-auto-flow: column; grid-template-rows: repeat(7, 9px); gap: 2px`; empty cell 9x9 `#f3f4f6` with 1px `#e5e7eb`, filled cells step up the purple ramp.
- Done button: 1px `#a855f7`, white bg, purple text, 12px/600, `padding: 8px 12px`; hover `#faf5ff`; done state = solid `#a855f7` with white text, hover `#9333ea`.

**FAB**: fixed, `bottom: 40px; right: 32px`, 56x56, `#a855f7`, white plus glyph at 28px, square, hover `#9333ea`. Opens the Add Modal (package 05) — stub the callback.

## Done when
The grid reflows correctly, the done toggle updates streak + heatmap, and the layout matches the design file.
