# Package 05 — Add Modal (event / task / habit)

**Design reference:** `designs/Albas Add Modal.dc.html`

**Wave 3 — after Dashboard, To-Do and Habits land.**

## Files you own
`src/components/AddModal.tsx` + its styles; the callback wiring in Dashboard / To-Do / Habits (touch only the `onAdd` line in each).

## Shape
Dimmed backdrop + centered card: **470px wide**, white, 1px `#e5e7eb`, `box-shadow: 0 30px 70px rgba(15,23,42,.22)`, square, entrance `.22s cubic-bezier(.2,.8,.3,1)`.

Header (`padding: 18px 20px 0`): title 16px Sora 600, `letter-spacing: -.01em` — "New event" / "New task" / "New habit". Close button 26x26, transparent, `#9ca3af`, 14px X icon at `stroke-width: 2.2`.

Type segmented control: **Event · Task · Habit**, active = purple.

Body (`padding: 18px 20px 4px`, flex column, `gap: 14px`):
- Borderless 18px/500 title input. Placeholders — event: `Team sync, dentist, flight…`; task: `What needs doing?`; habit: `Read, run, meditate…`
- **Event only**: a date/time block — `background: #f8fafb`, 1px `#e5e7eb`, `padding: 12px`, `grid-template-columns: 46px 1fr auto`, entering with a `.2s` row animation. Hidden when All-day is on.
- **Habit only**: a "Repeats" group — 11px/600/uppercase `#9ca3af` label over Daily / Weekly / Monthly / Yearly options.

**Optional-field chips**: a catalog per type, added and removed by chip. Event: All-day, Repeat, Location, Reminder, Category, Description. Task: Due date, Priority, Reminder, Category, Description. Habit: Daily target, Reminder, and the rest — read the full lists off the design file's `CATALOG` object.

Submit is disabled until the title is non-empty.

## The height spring — implement this exactly
When fields are added or removed the card **springs** to its new height; it does not CSS-transition. Measure the content height, then integrate a damped spring each frame in a `requestAnimationFrame` loop:

```
k = 190 * snappiness        // snappiness defaults to 1
d = 2 * sqrt(k) * 0.92      // slightly underdamped
```

Apply the animated height to the card with `overflow: hidden`. Stop the loop when velocity and displacement both settle. Respect `prefers-reduced-motion`: snap instantly instead.

## Done when
All three types render their correct fields, chips add and remove, the spring feels identical to the design file, and the modal opens from all three parent screens.
