import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { fmt, weekOf } from '../../dates';
import { byHabitOrder, isHabit, repeatLabel, statusLabel } from '../../seedLogic';
import type { Seed } from '../../types';
import { useIsCoarsePointer } from '../../useMedia';
import { HabitStrip } from '../habits/HabitStrip';
import { cellsFor, groupHabits } from '../habits/habitModel';
import { InlineEditor } from '../InlineEditor';
import { Icon } from '../ui/icon';
import { SectionHeading } from '../ui/section-heading';
import { useInlineEdit } from '../useInlineEdit';

/**
 * Repeating to-do: title + status, then the week strip. The title opens the inline editor (desktop) or the
 * modal (touch).
 */
function RepeatingRow({
  seed,
  onEdit,
  expanded,
  onToggleExpand,
}: {
  seed: Seed;
  onEdit: (s: Seed) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { firstDayOfWeek, colorOf, iconOf } = useApp();
  const coarse = useIsCoarsePointer();
  const color = colorOf(seed);
  const icon = iconOf(seed);
  const today = fmt(new Date());
  const cells = cellsFor(seed, weekOf(new Date(), firstDayOfWeek), firstDayOfWeek, today);

  return (
    <div className="group">
      <div className="flex items-center gap-xs mb-xs">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => (coarse ? onEdit(seed) : onToggleExpand())}
          className={cn(
            'micro-label flex items-center gap-1 truncate text-left min-w-0 hover:underline',
            COLOR_CLASSES[color].text,
          )}
          title={repeatLabel(seed, firstDayOfWeek)}
        >
          {icon && <Icon name={icon} size="0.75rem" />}
          {seed.title}
        </button>
        <span className="text-xs text-ink-muted ml-auto flex-shrink-0">{statusLabel(seed, today, firstDayOfWeek)}</span>
      </div>
      {expanded && !coarse && (
        <InlineEditor seed={seed} autoFocusTitle onAdvanced={() => onEdit(seed)} className="mb-xs" />
      )}
      <HabitStrip seed={seed} cells={cells} color={color} today={today} cellClass="size-6" spread />
    </div>
  );
}

/** Repeating to-dos (habits and chores) with their week strips. */
export function HabitsSection({ onEdit }: { onEdit: (s: Seed) => void }) {
  const { seeds, habitsLayout, isVisible } = useApp();
  const { expandedId, toggleExpanded } = useInlineEdit();

  const habits = seeds.filter((s) => isHabit(s) && isVisible(s)).sort(byHabitOrder);
  if (habits.length === 0) return null;

  // The Settings layout applies here too; the phone just can't drag.
  return (
    <div className="mb-md">
      <SectionHeading className="mb-md font-bold">Habits</SectionHeading>
      {groupHabits(habits, habitsLayout).map(({ key, label, seeds: rows }) => (
        <div key={key} className="space-y-md mb-md">
          {label !== '' && <SectionHeading className="text-xs">{label}</SectionHeading>}
          {rows.map((seed) => (
            <RepeatingRow
              key={seed.id}
              seed={seed}
              onEdit={onEdit}
              expanded={expandedId === seed.id}
              onToggleExpand={() => toggleExpanded(seed.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
