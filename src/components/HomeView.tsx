import { useState } from 'react';
import { Icon } from './ui/icon';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';
import CalendarNav from './calendar/CalendarNav';
import AddModal from './AddModal';
import SearchPalette from './search/SearchPalette';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { fmt, weekOf, parse, shortDate } from '../dates';
import { useInlineEdit } from './useInlineEdit';
import type { Seed } from '../types';

/** The phone header's square icon button — must match `CalendarNav`'s view picker so the bar's two corners agree. */
const MOBILE_HEADER_BUTTON =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center border-0 bg-subtle p-0 text-ink transition-all active:bg-line';

type MobileTab = 'dashboard' | 'habits' | 'tasks';

/** The search scope each tab opens on. */
const SEARCH_SCOPE = { dashboard: 'calendar', habits: 'habits', tasks: 'todos' } as const;

const TABS: { tab: MobileTab; label: string; icon: string }[] = [
  { tab: 'habits', label: 'Habits', icon: 'repeat' },
  { tab: 'dashboard', label: 'Dashboard', icon: 'home' },
  { tab: 'tasks', label: 'Tasks', icon: 'check_box' },
];

const TAB =
  'flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent p-2 text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted transition-all active:bg-subtle';
const SCREEN = 'flex w-full flex-col';
/** A hairline of side padding, and room at the bottom for the tab bar and the add button. */
const CONTENT = 'px-1 pt-1 pb-32';

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
  const { calendarMode, currentMonth, selectedDate, setActiveView, firstDayOfWeek } = useApp();
  const { setEditing, editModal } = useInlineEdit();
  const [currentTab, setCurrentTab] = useState<MobileTab>('dashboard');
  const [adding, setAdding] = useState(false);
  const displayDate = () => {
    if (calendarMode === 'month') {
      return currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else if (calendarMode === 'week') {
      const week = weekOf(parse(selectedDate ?? fmt(new Date())), firstDayOfWeek);
      return `${shortDate(week[0])} – ${shortDate(week[6])}`;
    } else {
      return parse(selectedDate ?? fmt(new Date())).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-page">
      {/* Mobile Header: [calendar view] [date / tab name] [search, settings].
          Both sides are two buttons wide so the title stays centred. */}
      <div className="z-10 flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface px-2">
        <div className="flex w-18 gap-2">{currentTab === 'dashboard' && <CalendarNav compact />}</div>
        <div className="flex-1 text-center font-heading text-sm font-bold text-ink">
          {/* Top bar view with either the date or the tab name, depending on which tab is active. */}
          {currentTab === 'dashboard' && displayDate()}
          {currentTab === 'habits' && 'Habits'}
          {currentTab === 'tasks' && 'Tasks'}
        </div>
        <div className="flex w-18 justify-end gap-2">
          <SearchPalette scope={SEARCH_SCOPE[currentTab]} compact className={MOBILE_HEADER_BUTTON} />
          {/* The only route to Settings on a phone: the sidebar and bottom bar
              are `max-md:hidden`, and the tab row has no slot. */}
          <button
            type="button"
            className={MOBILE_HEADER_BUTTON}
            title="Settings"
            onClick={() => setActiveView('settings')}
          >
            <Icon name="settings" size="1rem" />
          </button>
        </div>
      </div>

      {/* Screen Container */}
      <div className="relative flex-1 overflow-x-hidden overflow-y-auto bg-page">
        {currentTab === 'dashboard' && <DashboardScreen setEditing={setEditing} />}
        {currentTab === 'habits' && <HabitsScreen setEditing={setEditing} />}
        {currentTab === 'tasks' && <TasksScreen setEditing={setEditing} />}
      </div>

      {/* Adding on the list tabs; the dashboard adds by tapping a day. */}
      {currentTab !== 'dashboard' && (
        <button
          type="button"
          title={currentTab === 'habits' ? 'New habit' : 'New to-do'}
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-19 z-20 flex size-12 cursor-pointer items-center justify-center border-0 bg-accent text-on-accent shadow-pop active:bg-accent-hover"
        >
          <Icon name="add" size="1.25rem" />
        </button>
      )}

      {/* Bottom Tabs */}
      <div className="fixed bottom-0 left-0 z-20 flex h-15 w-full items-center justify-around gap-2 border-t border-line bg-surface">
        {TABS.map(({ tab, label, icon }) => (
          <button
            type="button"
            key={tab}
            className={cn(TAB, currentTab === tab && 'text-accent')}
            onClick={() => setCurrentTab(tab)}
            title={label}
          >
            <Icon name={icon} size="1.125rem" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {editModal}
      {adding && (
        // A habit starts today; a to-do starts undated, as the old quick-add did.
        <AddModal
          defaultDoable
          defaultRepeating={currentTab === 'habits'}
          defaultDate={currentTab === 'habits' ? fmt(new Date()) : ''}
          onClose={() => setAdding(false)}
        />
      )}
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
function DashboardScreen({ setEditing }: { setEditing: (s: Seed | null) => void }) {
  return (
    <div className={SCREEN}>
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
function HabitsScreen({ setEditing }: { setEditing: (s: Seed | null) => void }) {
  return (
    <div className={SCREEN}>
      <div className={CONTENT}>
        <HabitsSection onEdit={setEditing} />
      </div>
    </div>
  );
}

/** Tasks screen: full list of tasks. */
function TasksScreen({ setEditing }: { setEditing: (s: Seed | null) => void }) {
  return (
    <div className={SCREEN}>
      <div className={CONTENT}>
        <TasksSection onEdit={setEditing} />
      </div>
    </div>
  );
}
