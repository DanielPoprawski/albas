import TodoPanel from './TodoPanel';

/**
 * The calendar's companion column — habits and tasks beside the month.
 *
 * `AppShell` mounts it for the calendar view only. It used to render on every
 * desktop view, which put the habit strips beside Settings and beside the
 * To-Do view's own list of the same to-dos.
 */
export default function RightPanel() {
  return (
    // A flex child, not fixed: it takes whatever width the month grid didn't
    // need. 280px is the floor at which the habit week-strips still fit.
    <aside className="flex-1 min-w-[280px] h-full border-l border-line bg-chrome flex flex-col py-md px-sm overflow-y-auto scrollbar-hide">
      <TodoPanel habits />
    </aside>
  );
}
