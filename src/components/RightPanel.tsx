import TodoPanel from './TodoPanel';

export default function RightPanel() {
  return (
    <aside className="fixed right-0 top-16 h-[calc(100%-64px)] w-[280px] z-30 border-l border-line bg-chrome flex flex-col py-md px-sm overflow-y-auto scrollbar-hide">
      <TodoPanel />
    </aside>
  );
}
