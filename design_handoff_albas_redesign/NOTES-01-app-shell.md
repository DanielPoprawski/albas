# Package 01 — app shell: notes for later packages

Written when package 01 landed. Everything here is something a *later* package
has to pick up; the shell itself is done.

- **`ActiveView` has no `habits` value** (`src/types.ts`, not owned by package
  01), so `AppShell` carries its own `Route` type (`dashboard | todo | habits |
  settings`) and maps it onto the stored view where one exists. The Habits
  route currently renders a placeholder for package 04. Whoever owns the type
  should add `habits` to it, after which the shell can drop the local mapping.

- **The FAB that opened `AddModal` is gone.** The design puts an "+ Add" button
  in the dashboard's calendar header instead, so the trigger belongs to package
  02 / 05. Until one of them lands there is no way to open the add modal.

- **Weight has no destination.** The redesign's sidebar has exactly four items
  and Weight is not one of them, so `WeightPanel` is currently unreachable.
  That needs a decision — fold it into Habits, or add a fifth nav item.

- **`TopBar.tsx`, `Sidebar.tsx` and `StatusBar.tsx` are now unimported.** They
  were left on disk untouched because package 01 owns only `AppShell.tsx` and
  the shell's styles in `App.css`. Delete them once nothing is expected to
  return to them.

Verification note: package 01 was checked with `bun run build` (tsc + vite) and
by reading the design CSS. No browser was available in that session, so it was
never compared against the design pixel for pixel.
