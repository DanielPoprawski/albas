import { useState } from 'react';
import { Settings, Repeat2, Home, CheckSquare } from 'lucide-react';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';
import CalendarNav from './calendar/CalendarNav';
import QuickAddField from './QuickAddField';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { useInlineEdit } from './useInlineEdit';
import type { Todo } from '../types';

/** The phone header's square icon button — must match `CalendarNav`'s view picker so the bar's two corners agree. */
const MOBILE_HEADER_BUTTON =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center border-0 bg-subtle p-0 text-ink transition-all active:bg-line';

type MobileTab = 'dashboard' | 'habits' | 'tasks';

const TABS: { tab: MobileTab; label: string; Icon: typeof Home }[] = [
  { tab: 'habits', label: 'Habits', Icon: Repeat2 },
  { tab: 'dashboard', label: 'Dashboard', Icon: Home },
  { tab: 'tasks', label: 'Tasks', Icon: CheckSquare },
];

const TAB =
  'flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent p-2 text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted transition-all active:bg-subtle';
const SCREEN = 'flex w-full flex-col';
/** A hairline of side padding, and room at the bottom for the tab bar. */
const CONTENT = 'px-1 pt-1 pb-20';

/**
 * The phone's dashboard: a header, three tabbed screens (habits, the
 * calendar-plus-lists dashboard, tasks) and the bottom tab bar. `AppShell`
 * mounts it only under the phone breakpoint; the desktop has the month view
 * and `RightPanel` instead.
 *
 * The calendar takes a bounded height rather than `flex-1` — it has to stop
 * somewhere for the sections below it to be reachable by scrolling, and a
 * viewport-relative height keeps roughly the same amount of month visible on
 * any device.
 */
export default function HomeView() {
  const { setActiveView } = useApp();
  const { setEditing, editModal } = useInlineEdit();
  const [currentTab, setCurrentTab] = useState<MobileTab>('dashboard');
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  return (
    <div className="flex h-full w-full flex-col bg-page">
      {/* Mobile Header: [calendar view] [date / tab name] [settings] */}
      <div className="z-10 flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface px-2">
        <div className="flex gap-2">
          {currentTab === 'dashboard' ? (
            <CalendarNav compact />
          ) : (
            // Keeps the title centred on the other tabs.
            <div className={cn(MOBILE_HEADER_BUTTON, 'invisible')} aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 text-center font-heading text-sm font-bold text-ink">
          {currentTab === 'dashboard' && today}
          {currentTab === 'habits' && 'Habits'}
          {currentTab === 'tasks' && 'Tasks'}
        </div>
        <div className="flex gap-2">
          {/* The only route to Settings on a phone: the sidebar and bottom bar
              are `max-md:hidden`, and the tab row has no slot. */}
          <button
            type="button"
            className={MOBILE_HEADER_BUTTON}
            title="Settings"
            onClick={() => setActiveView('settings')}
          >
            <Settings size="1rem" />
          </button>
        </div>
      </div>

      {/* Screen Container */}
      <div className="relative flex-1 overflow-x-hidden overflow-y-auto bg-page">
        {currentTab === 'dashboard' && <DashboardScreen setEditing={setEditing} />}
        {currentTab === 'habits' && <HabitsScreen setEditing={setEditing} />}
        {currentTab === 'tasks' && <TasksScreen setEditing={setEditing} />}
      </div>

      {/* Bottom Tabs */}
      <div className="fixed bottom-0 left-0 z-20 flex h-15 w-full items-center justify-around gap-2 border-t border-line bg-surface">
        {TABS.map(({ tab, label, Icon }) => (
          <button
            type="button"
            key={tab}
            className={cn(TAB, currentTab === tab && 'text-accent')}
            onClick={() => setCurrentTab(tab)}
            title={label}
          >
            <Icon size="1.125rem" strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {editModal}
    </div>
  );
}

/**
 * The calendar body in its current mode. The phone's mode button rides in the
 * top bar, so there is no navigation row here.
 */
function MobileCalendar() {
  const { calendarMode } = useApp();
  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      {calendarMode === 'month' && <MonthView isMobile />}
      {calendarMode === 'week' && <WeekView />}
      {calendarMode === 'day' && <DayView />}
    </div>
  );
}

/** Dashboard screen: mini calendar + habits + tasks. */
function DashboardScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className={SCREEN}>
      <QuickAddField type="event" className="mx-2 mt-2" />
      {/* Edge to edge: every pixel of side padding is a letter of an event
          title that doesn't fit in a cell. */}
      <div className="shrink-0 border-b border-line">
        <MobileCalendar />
      </div>
      <div className={CONTENT}>
        <HabitsSection onEdit={setEditing} />
        <TasksSection onEdit={setEditing} />
      </div>
    </div>
  );
}

/** Habits screen: full list of habits. */
function HabitsScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className={SCREEN}>
      <div className={CONTENT}>
        <QuickAddField type="habit" className="mb-3" />
        <HabitsSection onEdit={setEditing} />
      </div>
    </div>
  );
}

/** Tasks screen: full list of tasks. */
function TasksScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className={SCREEN}>
      <div className={CONTENT}>
        <QuickAddField type="task" className="mb-3" />
        <TasksSection onEdit={setEditing} />
      </div>
    </div>
  );
}
