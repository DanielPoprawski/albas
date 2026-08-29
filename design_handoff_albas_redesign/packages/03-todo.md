# Package 03 — To-Do

**Design reference:** `designs/Albas To-Do.dc.html`

**Wave 2 — parallel.**

## Files you own
The to-do view component(s) and their styles.

## Structure
Main list order, top to bottom: **All** (aggregate) -> one section per active category (color-coded header) -> **Completed** (always last).

Sort inside every section: **Important -> Due Date -> Time Added**.

## Row anatomy
The star toggle (importance) sits **to the left of** the checkbox, then title, then meta (due date, category dot). Both toggles are square; purple when set.

## Add a task
A popped-out card — its own margin, padding and card shadow — not an inline bar.

## Sidebar section
A bordered Categories card with a purple color-coded header row that collapses/expands via a chevron. Inside: **All** and **Completed** checkbox rows alongside the five categories (Work, Personal, Shopping, Health, Finance). Each checkbox toggles that category's visibility everywhere in the view.

## Done when
Sorting, collapsing, and category filtering all work, and the layout matches the design file.
