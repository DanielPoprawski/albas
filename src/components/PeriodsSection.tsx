import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { fmt, shortDate } from '../dates';
import { periodProgress, periodStatusLabel } from '../periodLogic';
import { HABIT_COLORS } from './habitColors';
import AddModal from './AddModal';
import type { Period } from '../types';

export default function PeriodsSection() {
  const { periods, habits, deletePeriod } = useApp();
  const [editing, setEditing] = useState<Period | null>(null);

  const todayStr = fmt(new Date());
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="mt-lg">
      <h3 className="text-label-md text-outline-variant mb-md uppercase tracking-wider">
        Periods
      </h3>

      {sorted.length === 0 && (
        <p className="text-body-sm text-outline-variant">
          No periods yet. Use the + button to plan a multi-week program — a 12-week
          gym routine, a diet — and link habits to track your follow-through.
        </p>
      )}

      <div className="space-y-sm">
        {sorted.map(period => {
          const hex = HABIT_COLORS[period.colorKey].hex;
          const progress = periodProgress(period, habits, todayStr);
          const linked = period.habitIds
            .map(id => habits.find(h => h.id === id))
            .filter((h): h is NonNullable<typeof h> => !!h);
          return (
            <div key={period.id} className="group p-sm rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-sm">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-body-md font-semibold text-inverse-on-surface min-w-0 truncate">
                  {period.name}
                </span>
                <span className="text-[10px] text-outline-variant flex-shrink-0">
                  {shortDate(period.startDate)} – {shortDate(period.endDate)}
                </span>
                <span className="ml-auto flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => setEditing(period)}
                    title="Edit period"
                    className="w-6 h-6 flex items-center justify-center rounded text-outline-variant hover:text-inverse-on-surface hover:bg-white/10 transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>edit</span>
                  </button>
                  <button
                    onClick={() => deletePeriod(period.id)}
                    title="Delete period"
                    className="w-6 h-6 flex items-center justify-center rounded text-outline-variant hover:text-tertiary-fixed-dim hover:bg-white/10 transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete</span>
                  </button>
                </span>
              </div>

              {/* Time progress bar */}
              <div className="mt-sm flex items-center gap-sm">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(progress.timeFraction * 100)}%`, backgroundColor: hex }}
                  />
                </div>
                <span className="text-[10px] text-outline-variant tabular-nums whitespace-nowrap">
                  {periodStatusLabel(progress, period, todayStr)}
                </span>
              </div>

              {/* Linked-habit completion */}
              {linked.length > 0 && (
                <div className="mt-xs flex items-center gap-sm">
                  <span className="text-[10px] text-outline-variant min-w-0 truncate">
                    {linked.map(h => h.name).join(', ')}
                  </span>
                  {progress.habitCompletion !== null && (
                    <span className="ml-auto text-[10px] font-bold tabular-nums flex-shrink-0" style={{ color: hex }}>
                      {Math.round(progress.habitCompletion * 100)}% done
                    </span>
                  )}
                </div>
              )}

              {period.notes && (
                <p className="mt-xs text-[11px] text-outline-variant">{period.notes}</p>
              )}
            </div>
          );
        })}
      </div>

      {editing && <AddModal editPeriod={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
