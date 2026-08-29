import { SidebarSlot } from '../AppShell';

/**
 * Calendar categories sidebar section. Renders as a portal into the sidebar's
 * second slot, showing visibility toggles for each category found in the app's
 * events and to-dos.
 *
 * For now, this is a stub showing all possible categories. The actual list and
 * visibility state is future work.
 */
export default function CalendarCategories() {
  // Stub categories matching the design file
  const categories: { name: string; color: string }[] = [
    { name: 'Birthdays', color: '#a855f7' },
    { name: 'Work', color: '#f59e0b' },
    { name: 'Appointments', color: '#3b82f6' },
    { name: 'Personal', color: '#10b981' },
    { name: 'School', color: '#ef4444' },
  ];

  return (
    <SidebarSlot>
      <div className="sidebar-section">
        <div className="sidebar-title">Categories</div>
        {categories.map((cat) => (
          <div key={cat.name} className="category-item">
            <div className="category-check checked">✓</div>
            <div
              className="category-color"
              style={{ background: cat.color }}
            />
            <span>{cat.name}</span>
          </div>
        ))}
      </div>
    </SidebarSlot>
  );
}
