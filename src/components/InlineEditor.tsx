import { useEffect, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { movedEnd } from '../eventLogic';
import { GENERAL, isRepeating } from '../todoLogic';
import type { CalendarEvent, Category, Routine, Todo } from '../types';
import DateField from './forms/DateField';
import { ColorPopover, Select } from './forms/shared';
import { ROUTINE_OPTIONS } from './habits/habitModel';
import { Dot } from './ui/tag';
import { StarButton } from './ui/star';

function categoryOptions(categories: Category[]) {
  return [{ value: '', label: GENERAL }, ...categories.map((c) => ({ value: c.id, label: c.name }))];
}

/**
 * The title input every inline editor shares: a draft that commits on blur
 * and Enter (trimmed, an empty draft is ignored), and reverts on Escape.
 */
function TitleInput({
  value,
  onCommit,
  autoFocus,
  label,
}: {
  value: string;
  onCommit: (name: string) => void;
  autoFocus?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const name = draft.trim();
    if (!name) {
      setDraft(value);
      return;
    }
    if (name !== value) onCommit(name);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(value);
      e.currentTarget.blur();
    }
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      aria-label={label}
      autoFocus={autoFocus}
      autoComplete="off"
      enterKeyHint="done"
      className="field-input flex-1 min-w-[8rem]"
    />
  );
}

function AdvancedButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button type="button" onClick={onClick} className="text-xs text-accent hover:underline shrink-0">
      Advanced…
    </button>
  );
}

/** Stops a wrapping row's click/keyboard handlers from firing on edits made here. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Radix's Select treats '' as "nothing chosen", so the untagged routine gets a name of its own. */
const AUTO = 'auto';
const ROUTINE_CHOICES: { value: Routine | typeof AUTO; label: string }[] = [
  { value: AUTO, label: 'Auto' },
  ...ROUTINE_OPTIONS,
];

/** A habit's colour swatch: click to pick from the palette. */
function ColorSwatch({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={value}
      onChange={(hex) => {
        onChange(hex);
        setOpen(false);
      }}
    >
      <button type="button" aria-label="Colour" title="Colour" onClick={() => setOpen((v) => !v)} className="icon-btn">
        <Dot accent={value} size={12} />
      </button>
    </ColorPopover>
  );
}

/**
 * The light editor a list row, the search palette and quick-add show for a
 * single to-do: title, then a task's category or a habit's colour and
 * routine, star, due date. Every change is written straight through
 * `updateTodo`; "Advanced…" hands off to the full modal.
 */
export default function InlineEditor({
  todo,
  autoFocusTitle,
  onAdvanced,
  className,
}: {
  todo: Todo;
  autoFocusTitle?: boolean;
  onAdvanced?: () => void;
  className?: string;
}) {
  const { updateTodo, categoriesFor } = useApp();
  const repeating = isRepeating(todo);
  const options = categoryOptions(categoriesFor('tasks'));

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} onClick={stop} onKeyDown={stop}>
      <TitleInput
        value={todo.name}
        onCommit={(name) => updateTodo(todo.id, { name })}
        autoFocus={autoFocusTitle}
        label="Title"
      />
      {repeating ? (
        <>
          <ColorSwatch value={todo.colorKey} onChange={(colorKey) => updateTodo(todo.id, { colorKey })} />
          <Select
            options={ROUTINE_CHOICES}
            value={todo.routine || AUTO}
            onChange={(routine) => updateTodo(todo.id, { routine: routine === AUTO ? '' : routine })}
            className="w-auto"
          />
        </>
      ) : (
        <Select
          options={options}
          value={options.some((o) => o.value === todo.category) ? todo.category : ''}
          onChange={(category) => updateTodo(todo.id, { category })}
          className="w-auto"
        />
      )}
      <StarButton important={todo.important} onToggle={() => updateTodo(todo.id, { important: !todo.important })} />
      {!repeating && (
        <DateField
          value={todo.dueDate ?? ''}
          onChange={(dueDate) => updateTodo(todo.id, { dueDate: dueDate || null })}
          allowEmpty
          placeholder="No due date"
          aria-label="Due date"
          className="w-[9rem]"
        />
      )}
      <AdvancedButton onClick={onAdvanced} />
    </div>
  );
}

/** The event counterpart: title, category, start day. */
export function InlineEventEditor({
  event,
  autoFocusTitle,
  onAdvanced,
  className,
}: {
  event: CalendarEvent;
  autoFocusTitle?: boolean;
  onAdvanced?: () => void;
  className?: string;
}) {
  const { updateEvent, categoriesFor } = useApp();
  const options = categoryOptions(categoriesFor('calendar'));

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} onClick={stop} onKeyDown={stop}>
      <TitleInput
        value={event.title}
        onCommit={(title) => updateEvent(event.id, { title })}
        autoFocus={autoFocusTitle}
        label="Title"
      />
      <Select
        options={options}
        value={options.some((o) => o.value === event.category) ? event.category : ''}
        onChange={(category) => updateEvent(event.id, { category })}
        className="w-auto"
      />
      <DateField
        value={event.startDate}
        onChange={(startDate) => {
          // Keep the span's length when the start moves.
          updateEvent(event.id, { startDate, endDate: movedEnd(event.startDate, startDate, event.endDate) });
        }}
        aria-label="Start date"
        className="w-[9rem]"
      />
      <AdvancedButton onClick={onAdvanced} />
    </div>
  );
}
