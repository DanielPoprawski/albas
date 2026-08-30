import { useState } from 'react';
import { Settings, Repeat2, Home, CheckSquare } from 'lucide-react';
import Calendar from './Calendar';
import AddModal from './AddModal';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import { useIsMobile } from '../useMedia';
import { useApp } from '../context/AppContext';
import type { Todo } from '../types';

/**
 * The phone's only list surface: calendar, then habits, then tasks, in one
 * scroll. Merging Calendar and To-Do removes the drawer trip that used to sit
 * between "what's this week" and "what do I have to do".
 *
 * The calendar takes a bounded height rather than `flex-1` — it has to stop
 * somewhere for the sections below it to be reachable by scrolling, and a
 * viewport-relative height keeps roughly the same amount of month visible on
 * any device.
 */
export default function HomeView() {
  const [editing, setEditing] = useState<Todo | null>(null);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'dashboard' | 'habits' | 'tasks'>('dashboard');

  if (isMobile) {
    return (
      <MobileShell
        editing={editing}
        setEditing={setEditing}
        currentTab={mobileTab}
        setCurrentTab={setMobileTab}
      />
    );
  }

  // Desktop view (unchanged)
  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <div className="h-[60vh] min-h-[260px] flex flex-col">
        <Calendar isMobile />
      </div>

      <div className="p-sm">
        <HabitsSection onEdit={setEditing} />
        <TasksSection onEdit={setEditing} />
      </div>

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * Mobile dashboard with header, tabbed screens, and bottom navigation.
 */
function MobileShell({
  editing,
  setEditing,
  currentTab,
  setCurrentTab,
}: {
  editing: Todo | null;
  setEditing: (t: Todo | null) => void;
  currentTab: 'dashboard' | 'habits' | 'tasks';
  setCurrentTab: (tab: 'dashboard' | 'habits' | 'tasks') => void;
}) {
  const { setActiveView } = useApp();
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  return (
    <div className="mobile-shell">
      {/* Mobile Header */}
      <div className="mobile-header">
        <div className="mobile-header-title">
          {currentTab === 'dashboard' && today}
          {currentTab === 'habits' && 'Habits'}
          {currentTab === 'tasks' && 'Tasks'}
        </div>
        <div className="mobile-header-buttons">
          {/* The only route to Settings on a phone: `.sidebar` and `.bottom-bar`
              are both display:none under 768px, and the tab row has no slot. */}
          <button className="mobile-header-button" title="Settings" onClick={() => setActiveView('settings')}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Screen Container */}
      <div className="mobile-screen-container">
        {currentTab === 'dashboard' && <DashboardScreen setEditing={setEditing} />}
        {currentTab === 'habits' && <HabitsScreen setEditing={setEditing} />}
        {currentTab === 'tasks' && <TasksScreen setEditing={setEditing} />}
      </div>

      {/* Bottom Tabs */}
      <div className="mobile-tabs">
        <button
          className={`mobile-tab ${currentTab === 'habits' ? 'active' : ''}`}
          onClick={() => setCurrentTab('habits')}
          title="Habits"
        >
          <Repeat2 size={18} className="mobile-tab-icon" />
          <span className="mobile-tab-label">Habits</span>
        </button>
        <button
          className={`mobile-tab ${currentTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setCurrentTab('dashboard')}
          title="Dashboard"
        >
          <Home size={18} className="mobile-tab-icon" />
          <span className="mobile-tab-label">Dashboard</span>
        </button>
        <button
          className={`mobile-tab ${currentTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setCurrentTab('tasks')}
          title="Tasks"
        >
          <CheckSquare size={18} className="mobile-tab-icon" />
          <span className="mobile-tab-label">Tasks</span>
        </button>
      </div>

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * Dashboard screen: mini calendar + habits + tasks
 */
function DashboardScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className="mobile-screen">
      <div className="mobile-calendar-section">
        <Calendar isMobile />
      </div>
      <div className="mobile-content-section">
        <HabitsSection onEdit={setEditing} />
        <TasksSection onEdit={setEditing} />
      </div>
    </div>
  );
}

/**
 * Habits screen: full list of habits
 */
function HabitsScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className="mobile-screen">
      <div className="mobile-content-section">
        <HabitsSection onEdit={setEditing} />
      </div>
    </div>
  );
}

/**
 * Tasks screen: full list of tasks
 */
function TasksScreen({ setEditing }: { setEditing: (t: Todo | null) => void }) {
  return (
    <div className="mobile-screen">
      <div className="mobile-content-section">
        <TasksSection onEdit={setEditing} />
      </div>
    </div>
  );
}
