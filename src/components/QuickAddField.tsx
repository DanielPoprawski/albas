import { useEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { buildCreate } from '../createItem';
import InlineEditor, { InlineEventEditor } from './InlineEditor';
import { fmt } from '../dates';
import { parseWhen, stripMatch } from '../nlDate';
import type { AddType } from '../types';
import AddModal from './AddModal';

const PLACEHOLDER: Record<AddType, string> = {
  event: 'New event… ("dentist tue 3pm", "trip sun to thu")',
  task: 'New task… ("call mom tomorrow")',
  habit: 'New habit…',
};

/**
 * The one-line way to add something: type a name (with a date phrase, if
 * any) and press Enter. This is the create control on every list surface,
 * phone and desktop alike — there is no floating "+". The trailing icon
 * opens the full modal with whatever was typed already in the title, for
 * the fields a line can't carry (reminders, repeat rules). What was just
 * added stays open in an inline editor under the field — category, star,
 * date — until Escape, a click elsewhere, or the next add.
 *
 * An event with a parsed time is an hour long unless a range was given; one
 * without a time is all-day, so "trip sun to thu" lands as a four-day bar.
 */
export default function QuickAddField({
  type,
  defaultCategory,
  className,
  variant = 'field',
}: {
  type: AddType;
  /** Pre-assign a category id (e.g. a category's own header). */
  defaultCategory?: string;
  className?: string;
  /**
   * `field` is the bordered input box. `row` restyles the same control as the
   * last row of a bordered list (the Habits page): a dashed square where the
   * row's checkbox would be, which turns solid accent while typing.
   */
  variant?: 'field' | 'row';
}) {
  const { addEvent, addTodo, selectedDate, todos, events } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  // `addTodo`/`addEvent` mint the id themselves, so the row just created is
  // found by name once it lands in state (appended last, so the final match).
  const [pendingName, setPendingName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingName === null) return;
    const list: { id: string; name: string }[] =
      type === 'event' ? events.map((e) => ({ id: e.id, name: e.title })) : todos;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].name === pendingName) {
        setLastId(list[i].id);
        setPendingName(null);
        return;
      }
    }
  }, [pendingName, type, events, todos]);

  // The item just created, looked up live so the editor reflects its edits.
  const lastTodo = lastId ? todos.find((t) => t.id === lastId) : undefined;
  const lastEvent = lastId && !lastTodo ? events.find((e) => e.id === lastId) : undefined;
  const editing = lastTodo ?? lastEvent;

  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setLastId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [editing]);

  function submit() {
    const raw = text.trim();
    if (!raw) return;
    const when = parseWhen(raw);
    const stripped = when ? stripMatch(raw, when.matched) : raw;
    const title = stripped || raw;
    const today = fmt(new Date());
    const startDate = when?.start.date ?? (type === 'event' ? (selectedDate ?? today) : today);
    const payload = buildCreate(type, title, {
      startDate,
      startTime: when?.start.time ?? null,
      endDate: when?.end?.date,
      endTime: when?.end?.time ?? null,
      allDay: type === 'event' && !when?.start.time,
      dueDate: type === 'task' ? (when?.start.date ?? null) : startDate,
      category: defaultCategory,
    });
    if (payload.kind === 'event') addEvent(payload.event);
    else addTodo(payload.todo);
    setLastId(null);
    setPendingName(payload.kind === 'event' ? payload.event.title : payload.todo.name);
    setText('');
  }

  const row = variant === 'row';
  return (
    <div
      ref={rootRef}
      className={cn('flex flex-col', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && editing) {
          e.stopPropagation();
          setLastId(null);
        }
      }}
    >
      <div
        className={cn(
          row
            ? 'group flex items-center gap-5 px-3 py-2.5 bg-surface transition-colors duration-150 hover:bg-surface-hover focus-within:bg-surface-hover'
            : 'flex items-center gap-2 border border-line bg-surface px-3 py-2',
        )}
      >
        {row ? (
          <span
            aria-hidden="true"
            className="size-[1.375rem] shrink-0 flex items-center justify-center border border-dashed border-line-strong text-ink-muted transition-colors group-focus-within:border-solid group-focus-within:border-accent group-focus-within:text-accent"
          >
            <Plus size="0.8125rem" strokeWidth={2.5} />
          </span>
        ) : (
          <Plus size="0.875rem" strokeWidth={2.5} className="shrink-0 text-ink-muted" aria-hidden="true" />
        )}
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
          className={cn(
            'shrink-0 flex items-center text-ink-muted hover:text-ink',
            row &&
              'size-7 justify-center border border-transparent transition-colors hover:border-line hover:bg-subtle',
          )}
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
      {lastTodo && <InlineEditor todo={lastTodo} onAdvanced={() => setOpen(true)} className="px-3 py-2" />}
      {lastEvent && <InlineEventEditor event={lastEvent} onAdvanced={() => setOpen(true)} className="px-3 py-2" />}
    </div>
  );
}
