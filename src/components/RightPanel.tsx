import TodoPanel from './TodoPanel';

export default function RightPanel() {
  return (
    // A flex child now, not fixed: it takes whatever width the month grid
    // didn't need. 280px is the floor at which the habit week-strips still fit.
    <aside className="flex-1 min-w-[280px] h-full border-l border-line bg-chrome flex flex-col py-md px-sm overflow-y-auto scrollbar-hide">
      <TodoPanel />
    </aside>
  );
}
