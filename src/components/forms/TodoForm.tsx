import { useEffect, useState } from 'react';
import { StarButton } from '../ui/star';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR } from '../../colors';
import { samePatch } from '@/lib/utils';
import { stripMatch } from '../../nlDate';
import { GENERAL } from '../../todoLogic';
import type { Todo, TodoKind } from '../../types';
import { NlDateSuggestion, useNlSuggestion } from './NlDateSuggestion';
import {
  CheckboxRow,
  EditActions,
  inputClass,
  labelClass,
  SegmentedControl,
  Select,
  SubmitButton,
  type CommitRef,
  type CommitResult,
} from './shared';
import DateField from './DateField';
import RepeatField, { buildRepeat, draftFromRepeat, repeatError, type RepeatDraft } from './RepeatField';

/**
 * One form for everything that needs doing. The repeat rule is the whole
 * distinction: never = task, fixed cadence = habit, from-last-done = chore.
 */
export default function TodoForm({
  edit,
  defaultDate,
  onDone,
  commitRef,
}: {
  edit?: Todo;
  defaultDate?: string | null;
  onDone: () => void;
  /** Lets the modal commit on dismiss (scrim, Escape, back) without a submit. */
  commitRef?: CommitRef;
}) {
  const { addTodo, updateTodo, deleteTodo, selectedDate, firstDayOfWeek, categoriesFor } = useApp();

  const categoryOptions = [
    { value: '', label: GENERAL },
    ...categoriesFor('tasks').map((c) => ({ value: c.id, label: c.name })),
  ];

  const [name, setName] = useState(edit?.name ?? '');
  const [category, setCategory] = useState(edit?.category ?? '');
  const [important, setImportant] = useState(edit?.important ?? false);
  const [kind, setKind] = useState<TodoKind>(edit?.kind ?? 'yesno');
  const [target, setTarget] = useState(edit && edit.kind === 'measurable' ? String(edit.target) : '');
  const [unit, setUnit] = useState(edit?.unit ?? '');
  const [date, setDate] = useState(edit ? (edit.dueDate ?? '') : (defaultDate ?? selectedDate ?? ''));
  const [time, setTime] = useState(edit?.time ?? '');
  const [repeat, setRepeat] = useState<RepeatDraft>(() => draftFromRepeat(edit?.schedule));
  const [reminder, setReminder] = useState(edit?.reminder ?? false);
  const [error, setError] = useState('');

  // Natural-language date suggestion. Apply-only here — unlike the Add
  // modal's create path, this form can be editing an existing to-do, and
  // silently moving its date on submit just because the title contains a
  // date-shaped phrase would be a surprise, not a convenience.
  const { suggestion, dismiss: dismissSuggestion } = useNlSuggestion(name);

  function applySuggestion() {
    if (!suggestion) return;
    setDate(suggestion.start.date);
    if (suggestion.start.time) setTime(suggestion.start.time);
    setName((n) => stripMatch(n, suggestion.matched));
  }

  /** Validates and persists. Pure of navigation: the caller decides whether the result closes the modal. */
  function commit(): CommitResult {
    if (!name.trim()) return 'empty';
    const schedule = buildRepeat(repeat);
    if (!schedule) {
      setError(repeatError(repeat));
      return 'invalid';
    }
    const parsedTarget = parseInt(target, 10);
    // No `colorKey`: colours belong to categories (`displayColor`), and the
    // row the form was opened on carries its painted category colour, which
    // must not be written back as if the user had chosen it.
    const fields = {
      name: name.trim(),
      kind,
      unit: kind === 'measurable' ? unit.trim() : '',
      target: kind === 'measurable' && Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1,
      schedule,
      dueDate: date || null,
      time: time || null,
      reminder,
      category: category.trim(),
      important,
    };
    if (edit) {
      if (samePatch(fields, edit)) return 'unchanged';
      updateTodo(edit.id, fields);
    } else {
      addTodo({ ...fields, colorKey: DEFAULT_COLOR });
    }
    return 'saved';
  }

  useEffect(() => {
    if (commitRef) commitRef.current = commit;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = commit();
    if (result === 'saved' || result === 'unchanged') onDone();
    else if (result === 'empty') setError('Give it a name first.');
  }

  const repeating = repeat.choice !== 'once';

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Name</label>
        <div className="flex gap-sm items-center">
          <input
            className={inputClass}
            placeholder="e.g. Client meeting prep, Pushups, Take out trash"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {/* Star lives beside the name: it's a property of the to-do itself,
              not a scheduling detail, and this keeps it one tap from the top. */}
          <StarButton
            important={important}
            onToggle={() => setImportant((v) => !v)}
            size="1.25rem"
            className="size-9"
          />
        </div>
        {suggestion && (
          <NlDateSuggestion
            suggestion={suggestion}
            onApply={applySuggestion}
            onDismiss={dismissSuggestion}
            className="mt-xs"
          />
        )}
      </div>

      <div>
        <label className={labelClass}>Category</label>
        <Select options={categoryOptions} value={category} onChange={setCategory} />
      </div>

      <div>
        <label className={labelClass}>Type</label>
        <SegmentedControl
          options={[
            { value: 'yesno', label: 'Yes / No' },
            { value: 'measurable', label: 'Measurable' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>

      {kind === 'measurable' && (
        <div className="flex gap-sm">
          <div className="flex-1">
            <label className={labelClass}>Target</label>
            <input
              type="number"
              min="1"
              className={inputClass}
              placeholder="e.g. 30"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Unit</label>
            <input
              className={inputClass}
              placeholder="e.g. pushups, glasses"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>{repeating ? 'Starts (optional)' : 'Day (optional)'}</label>
          <DateField value={date} onChange={setDate} allowEmpty placeholder="none" aria-label="Date" />
        </div>
        <div className="w-28">
          <label className={labelClass}>Time</label>
          <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Repeat</label>
        <RepeatField value={repeat} onChange={setRepeat} firstDayOfWeek={firstDayOfWeek} />
      </div>

      <div>
        <label className={labelClass}>Notifications</label>
        <CheckboxRow checked={reminder} onChange={setReminder} label="Remind me on days it's due" />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {edit ? (
        <EditActions
          saveLabel="Done"
          onDelete={() => {
            deleteTodo(edit.id);
            onDone();
          }}
        />
      ) : (
        <SubmitButton label="Add To-Do" />
      )}
    </form>
  );
}
