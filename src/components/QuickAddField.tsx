import { useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { buildCreate } from '../createItem';
import { fmt } from '../dates';
import { parseWhen, stripMatch } from '../nlDate';
import type { AddType, CategoryScope } from '../types';
import AddModal from './AddModal';

const PLACEHOLDER: Record<AddType, string> = {
  event: 'New event… ("dentist tue 3pm", "trip sun to thu")',
  task: 'New task… ("call mom tomorrow")',
  habit: 'New habit…',
};

const SCOPE_FOR: Record<AddType, CategoryScope> = { event: 'calendar', task: 'tasks', habit: 'habits' };

/**
 * The one-line way to add something: type a name (with a date phrase, if
 * any) and press Enter. This is the create control on every list surface,
 * phone and desktop alike — there is no floating "+". The trailing icon
 * opens the full modal with whatever was typed already in the title, for
 * the fields a line can't carry (colour, reminders, repeat rules).
 *
 * An event with a parsed time is an hour long unless a range was given; one
 * without a time is all-day, so "trip sun to thu" lands as a four-day bar.
 */
export default function QuickAddField({
  type,
  defaultCategory,
  className,
}: {
  type: AddType;
  /** Pre-assign a category id (e.g. a category's own header). */
  defaultCategory?: string;
  className?: string;
}) {
  const { addEvent, addTodo, selectedDate, categoriesFor } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  function submit() {
    const raw = text.trim();
    if (!raw) return;
    const when = parseWhen(raw);
    const stripped = when ? stripMatch(raw, when.matched) : raw;
    const title = stripped || raw;
    const today = fmt(new Date());
    const startDate = when?.start.date ?? (type === 'event' ? (selectedDate ?? today) : today);
    const payload = buildCreate(
      type,
      title,
      {
        startDate,
        startTime: when?.start.time ?? null,
        endDate: when?.end?.date,
        endTime: when?.end?.time ?? null,
        allDay: type === 'event' && !when?.start.time,
        dueDate: type === 'task' ? (when?.start.date ?? null) : startDate,
        category: defaultCategory,
      },
      categoriesFor(SCOPE_FOR[type]),
    );
    if (payload.kind === 'event') addEvent(payload.event);
    else addTodo(payload.todo);
    setText('');
  }

  return (
    <div className={cn('flex items-center gap-2 border border-line bg-surface px-3 py-2', className)}>
      <Plus size="0.875rem" strokeWidth={2.5} className="shrink-0 text-ink-muted" aria-hidden="true" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={PLACEHOLDER[type]}
        aria-label={PLACEHOLDER[type].split('…')[0]}
        enterKeyHint="done"
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent border-0 text-ui text-ink placeholder:text-ink-muted"
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More options"
        title="More options"
        className="shrink-0 flex items-center text-ink-muted hover:text-ink"
      >
        <SlidersHorizontal size="0.875rem" />
      </button>
      {open && (
        <AddModal
          defaultType={type}
          defaultTitle={text}
          defaultCategory={defaultCategory}
          onSubmit={() => setText('')}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
