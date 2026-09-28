import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn, samePatch } from '@/lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Icon } from './ui/icon';
import { ModalChrome } from './ui/modal-chrome';
import { Segmented } from './ui/segmented';
import { Dot } from './ui/tag';
import { StarButton } from './ui/star';
import { type ColorKey, type Routine, ROUTINES } from '../types';
import { useApp } from '../context/AppContext';
import { COLOR_CLASSES, DEFAULT_COLOR } from '../colors';
import { buildCreate, splitLocation } from '../createItem';
import { REMINDER_QUICK, reminderLabel } from '../reminders';
import { addDays, addMinutes, fmt, nowFloor15, shortDate } from '../dates';
import { bySort, isRepeating, movedEnd, nextSort, resolveColor, targetOf, unitOf, validateSeed } from '../seedLogic';
import { TAG_ICONS } from '../tagIcons';
import { stripMatch, type NlDateMatch } from '../nlDate';
import { useIsCoarsePointer } from '../useMedia';
import DateField from './forms/DateField';
import { NlDateSuggestion, useNlSuggestion } from './forms/NlDateSuggestion';
import RepeatField, { buildRepeat, draftFromRepeat, repeatError, type RepeatDraft } from './forms/RepeatField';
import { ColorPicker, ColorPopover, Select } from './forms/shared';
import { useModalDismiss } from './ui/useModalDismiss';
import { useSpringHeight } from './ui/useSpringHeight';
import { FIELD_ROW, OPTIONS, PLACEHOLDER, type FieldKey, type Props } from './addModal/catalog';
import { FieldRow } from './addModal/parts';

const ROUTINE_OPTIONS = ROUTINES.filter((r): r is Exclude<Routine, ''> => r !== '').map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));

const LEAD_UNITS = [
  { value: 'minutes', label: 'minutes before', mult: 1 },
  { value: 'hours', label: 'hours before', mult: 60 },
  { value: 'days', label: 'days before', mult: 1440 },
  { value: 'weeks', label: 'weeks before', mult: 10080 },
] as const;

/**
 * What `commit()` did. A dismiss (scrim, ×, Escape, Android back) closes on
 * anything but `invalid`; the primary button additionally refuses `empty`.
 */
type CommitResult = 'saved' | 'unchanged' | 'empty' | 'invalid';

/** The footer's delete choices: a ghost button that stays red under the pointer. */
const DANGER = 'text-danger hover:text-danger';

/**
 * One modal, two modes. **Create** builds a seed out of the checkbox, the
 * When block and the option rows; **edit** seeds those same rows from the
 * stored seed, saves back over it, and puts Delete in the footer. Leaving
 * either way saves — only Cancel throws the draft away.
 */
export default function AddModal({
  onClose,
  edit,
  editDate,
  defaultDate,
  defaultTime,
  defaultAllDay,
  defaultTitle,
  defaultDoable,
  defaultRepeating,
  defaultList,
  onSubmit,
  snappiness = 1,
}: Props) {
  const { addSeed, updateSeed, deleteSeed, selectedDate, lists, tags, addList, addTag, tagById, firstDayOfWeek } =
    useApp();
  const initialDate = defaultDate ?? selectedDate ?? fmt(new Date());
  const initialTime = defaultTime ?? nowFloor15();
  // Where is the `Location: …` paragraph `buildCreate` folds into the notes.
  const stored = splitLocation(edit?.notes ?? '');

  const [doable, setDoable] = useState(edit ? edit.track !== null : !!defaultDoable);
  const [title, setTitle] = useState(edit?.title ?? defaultTitle ?? '');
  const [important, setImportant] = useState(edit?.important ?? false);
  const [color, setColor] = useState<ColorKey | null>(edit?.color ?? null);
  const [colorOpen, setColorOpen] = useState(false);
  /** '' = anytime (a doable, non-repeating seed only). */
  const [date, setDate] = useState(edit ? (edit.date ?? '') : initialDate);
  const [time, setTime] = useState(edit?.time ?? initialTime);
  const [endDate, setEndDate] = useState(edit?.endDate ?? edit?.date ?? initialDate);
  const [endTime, setEndTime] = useState(edit?.endTime ?? addMinutes(edit?.time ?? initialTime, 60));
  const [repeat, setRepeat] = useState<RepeatDraft>(() =>
    draftFromRepeat(edit?.repeat ?? (defaultRepeating ? { type: 'every', n: 1, unit: 'day' } : undefined)),
  );
  const [target, setTarget] = useState(edit ? targetOf(edit) : 1);
  const [unit, setUnit] = useState(edit ? unitOf(edit) : '');
  const [routine, setRoutine] = useState<Routine>(edit?.routine ?? '');
  const [list, setList] = useState(edit?.list ?? defaultList ?? '');
  const [seedTags, setSeedTags] = useState<string[]>(edit?.tags ?? []);
  const [location, setLocation] = useState(stored.location);
  const [notes, setNotes] = useState(stored.notes);
  /** Lead times (minutes) switched on; filled with a default when the row is revealed. */
  const [reminders, setReminders] = useState<Record<number, boolean>>(() =>
    Object.fromEntries((edit?.reminders ?? []).map((m) => [m, true])),
  );
  const [customRemOpen, setCustomRemOpen] = useState(false);
  const [customRemAmount, setCustomRemAmount] = useState('15');
  const [customRemUnit, setCustomRemUnit] = useState<(typeof LEAD_UNITS)[number]['value']>('minutes');
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<ColorKey>('blue');
  const [newTagIcon, setNewTagIcon] = useState(TAG_ICONS[0]);
  const [error, setError] = useState('');
  /** The delete confirmation, which replaces the footer's normal contents. */
  const [confirm, setConfirm] = useState(false);

  // A row starts on when what it holds is not the default; creating keeps
  // the old "nothing but what you asked for" rule, plus the caller's presets.
  const [on, setOn] = useState<Set<FieldKey>>(() => {
    const keys: FieldKey[] = [];
    if (edit) {
      if (edit.time) keys.push('time');
      if (edit.endDate || edit.endTime) keys.push('ends');
      if (isRepeating(edit)) keys.push('repeat');
      if (targetOf(edit) > 1 || unitOf(edit)) keys.push('target');
      if (edit.routine) keys.push('routine');
      if (edit.list) keys.push('list');
      if (edit.tags.length) keys.push('tags');
      if (stored.location) keys.push('location');
      if (edit.reminders.length) keys.push('remind');
      if (stored.notes) keys.push('notes');
    } else {
      // An event starts timed (an hour from now); a to-do starts all-day.
      if (defaultTime || (!defaultDoable && !defaultAllDay)) keys.push('time');
      if (defaultRepeating) keys.push('repeat');
      if (defaultList) keys.push('list');
    }
    return new Set(keys);
  });

  const coarse = useIsCoarsePointer();
  const repeating = on.has('repeat') && repeat.choice !== 'none';
  const options = OPTIONS.filter((o) => !o.when || o.when({ doable, repeating }));
  const has = (k: FieldKey) => on.has(k);
  const autoColor = resolveColor({ color: null, tags: has('tags') ? seedTags : [] }, tagById);
  const sortedLists = [...lists].sort(bySort);
  const sortedTags = [...tags].sort(bySort);

  const addOn = (key: FieldKey) => setOn((prev) => new Set([...prev, key]));
  const removeOn = (key: FieldKey) =>
    setOn((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  // One field's checkbox in the desktop options pane, or its `+` chip on the phone.
  const toggleField = (key: FieldKey) => {
    if (has(key)) {
      removeOn(key);
      return;
    }
    addOn(key);
    if (key === 'routine' && !routine) setRoutine('morning');
    // A reminder wants a lead: at the time for a to-do, ten minutes ahead of an event.
    if (key === 'remind' && Object.keys(reminders).length === 0) setReminders({ [doable ? 0 : 10]: true });
  };

  const setDoableAndPrune = (next: boolean) => {
    setDoable(next);
    if (!next) {
      removeOn('target');
      removeOn('routine');
    }
  };

  function createList() {
    const name = newListName.trim();
    if (!name) return;
    setList(addList({ name, sort: nextSort(lists) }).id);
    setNewListOpen(false);
    setNewListName('');
  }

  function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    const created = addTag({ name, color: newTagColor, icon: newTagIcon, sort: nextSort(tags) });
    setSeedTags((prev) => [...prev, created.id]);
    setNewTagOpen(false);
    setNewTagName('');
  }

  // Natural-language date suggestion. `dateTouched` tracks whether the user
  // has hand-edited any date/time field or already used Apply — a suggestion
  // only auto-applies on submit when nothing has, so it never silently
  // overrides a date the user actually chose.
  const { suggestion, dismiss: dismissSuggestion } = useNlSuggestion(title);
  const [dateTouched, setDateTouched] = useState(false);

  /** Pure: what Apply (or an auto-apply on submit) would change, without touching state. */
  function computeApplied(match: NlDateMatch) {
    return {
      title: stripMatch(title, match.matched),
      date: match.start.date,
      time: match.start.time ?? time,
      endDate: match.end?.date ?? match.start.date,
      endTime: match.end?.time ?? (match.start.time ? addMinutes(match.start.time, 60) : endTime),
      setsTime: !!match.start.time,
      setsEnd: !!match.end,
    };
  }

  function applySuggestion(match: NlDateMatch) {
    const next = computeApplied(match);
    setTitle(next.title);
    setDate(next.date);
    setTime(next.time);
    setEndDate(next.endDate);
    setEndTime(next.endTime);
    if (next.setsTime) addOn('time');
    if (next.setsEnd) addOn('ends');
    setDateTouched(true);
  }

  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const measure = useSpringHeight(cardRef, innerRef, snappiness);
  // Re-measure as soon as a row set changes, ahead of the observer.
  useEffect(() => {
    measure();
  }, [on, doable, repeat, suggestion, confirm, newListOpen, newTagOpen, customRemOpen, measure]);

  const canSubmit = title.trim().length > 0;

  /** Validates and persists. Pure of navigation: the caller decides what the result means for closing. */
  const commit = ({ lenient = false } = {}): CommitResult => {
    setError('');
    if (!canSubmit) return 'empty';

    // The repeat rule (only while its row is open): an invalid draft blocks
    // an explicit save with a message, and blocks a dismiss too once the seed
    // exists — silently rewriting a stored rule is worse than staying open. A
    // brand-new one falls back to not repeating instead.
    let rule = has('repeat')
      ? buildRepeat(repeat, edit?.repeat.type === 'every' ? edit.repeat.exdates : undefined)
      : { type: 'none' as const };
    if (!rule) {
      if (!lenient || edit) {
        setError(repeatError(repeat) ?? '');
        return 'invalid';
      }
      rule = { type: 'none' };
    }

    // An undismissed suggestion the user never hand-edited a date field for
    // (nor already applied) gets folded in here — computed rather than read
    // back from state, since `setState` inside this same call wouldn't be
    // visible until the next render. Never on an edit: a stored seed must not
    // reschedule itself just because its title reads like a date.
    const applied = !edit && !dateTouched && suggestion ? computeApplied(suggestion) : null;
    const active = new Set(on);
    if (applied?.setsTime) active.add('time');
    if (applied?.setsEnd) active.add('ends');
    const sDate = applied?.date ?? date;
    const sTime = active.has('time') ? (applied?.time ?? time) || null : null;
    const sEndDate = active.has('ends') ? (applied?.endDate ?? endDate) || null : null;
    const sEndTime = active.has('ends') && sTime ? (applied?.endTime ?? endTime) || null : null;

    // A field only reaches the payload if its row is actually showing — an
    // unrevealed row's state is a default, not a choice the user made. On an
    // edit that cuts both ways: removing a row clears what it held.
    const seed = buildCreate(applied?.title ?? title, {
      doable,
      date: sDate || null,
      time: sTime,
      endDate: sEndDate,
      endTime: sEndTime,
      repeat: rule,
      target: active.has('target') ? target : 1,
      unit: active.has('target') ? unit : '',
      location: active.has('location') ? location : '',
      notes: active.has('notes') ? notes : '',
      important,
      list: active.has('list') ? list : '',
      tags: active.has('tags') ? seedTags : [],
      reminders: active.has('remind')
        ? Object.keys(reminders)
            .map(Number)
            .filter((m) => reminders[m])
            .sort((a, b) => a - b)
        : [],
      routine: active.has('routine') ? routine : '',
      color,
    });

    // The one result that holds the modal open even on a dismiss: an end
    // before its start (or a missing date) is a typo, not something to save quietly.
    const problem = validateSeed(seed);
    if (problem) {
      setError(problem);
      return 'invalid';
    }

    if (edit) {
      // `sort` is the user's drag order, not something the form knows about.
      const { sort: _sort, ...patch } = seed;
      if (samePatch(patch, edit)) return 'unchanged';
      updateSeed(edit.id, patch);
    } else {
      addSeed(seed);
    }

    onSubmit?.({ title: seed.title, fields: { ...seed } });
    return 'saved';
  };

  const submit = () => {
    const result = commit();
    if (result === 'saved' || result === 'unchanged') onClose();
  };

  // Leaving with a title saves it. Only Cancel is an explicit "throw this
  // away" — and a dismiss while the delete confirmation shows is still just a
  // dismiss: it saves and closes, it does not delete.
  const dismiss = () => {
    if (commit({ lenient: true }) !== 'invalid') onClose();
  };
  useModalDismiss(dismiss);

  const recurring = !!edit && isRepeating(edit);
  const hasHistory = !!edit && Object.keys(edit.done).length > 0;

  function deleteItem() {
    if (edit) deleteSeed(edit.id);
    onClose();
  }

  function deleteJustThis() {
    if (edit?.repeat.type !== 'every' || !editDate) return;
    const r = edit.repeat;
    updateSeed(edit.id, { repeat: { ...r, exdates: [...(r.exdates ?? []), editDate] } });
    onClose();
  }

  function deleteFuture() {
    if (!edit || edit.repeat.type === 'none' || !editDate) return;
    const newUntil = addDays(editDate, -1);
    if (!edit.date || newUntil < edit.date) {
      deleteSeed(edit.id); // cutting off before the first occurrence = delete all
    } else {
      updateSeed(edit.id, { repeat: { ...edit.repeat, until: newUntil } });
    }
    onClose();
  }

  const timeInput = (label: string, value: string, set: (v: string) => void) => (
    <input
      type="time"
      aria-label={label}
      className="field-input w-auto"
      value={value}
      onChange={(e) => {
        set(e.target.value);
        setDateTouched(true);
      }}
    />
  );

  // A field's row. `time` and `ends` live inside the When block rather than
  // as rows of their own; the × on any other row switches that field off.
  const rows: Partial<Record<FieldKey, ReactNode>> = {
    repeat: has('repeat') && (
      <FieldRow label="Repeat" align="start" onRemove={() => removeOn('repeat')}>
        <div className="flex-1">
          <RepeatField value={repeat} onChange={setRepeat} firstDayOfWeek={firstDayOfWeek} />
        </div>
      </FieldRow>
    ),
    target: has('target') && (
      <FieldRow label="Target" onRemove={() => removeOn('target')}>
        <div className="flex items-center border border-line">
          <button
            type="button"
            aria-label="Decrease target"
            onClick={() => setTarget(Math.max(1, target - 1))}
            className="size-[1.875rem] max-md:size-10 bg-surface border-0 border-r border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
          >
            −
          </button>
          <span className="min-w-[4.625rem] text-center text-sm font-medium">
            {target} {target === 1 ? 'time / day' : 'times / day'}
          </span>
          <button
            type="button"
            aria-label="Increase target"
            onClick={() => setTarget(Math.min(99, target + 1))}
            className="size-[1.875rem] max-md:size-10 bg-surface border-0 border-l border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
          >
            +
          </button>
        </div>
        <input
          placeholder="unit (pages, glasses…)"
          aria-label="Unit"
          className="field-input w-32"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <div className="flex-1" />
      </FieldRow>
    ),
    routine: has('routine') && (
      <FieldRow label="Routine" onRemove={() => removeOn('routine')}>
        <Segmented aria-label="Routine" options={ROUTINE_OPTIONS} value={routine} onChange={setRoutine} />
      </FieldRow>
    ),
    list: has('list') && (
      <FieldRow label="List" align="start" onRemove={() => removeOn('list')}>
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {sortedLists.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setList(list === l.id ? '' : l.id)}
                className="chip"
                data-selected={list === l.id || undefined}
              >
                {l.name}
              </button>
            ))}
            <button type="button" onClick={() => setNewListOpen((v) => !v)} className="chip">
              New…
            </button>
          </div>
          {newListOpen && (
            <div className={cn(FIELD_ROW, 'gap-1.5')}>
              <input
                autoFocus
                placeholder="List name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createList();
                  }
                }}
                className="field-input flex-1"
              />
              <Button size="sm" onClick={createList} disabled={!newListName.trim()}>
                Add
              </Button>
            </div>
          )}
        </div>
      </FieldRow>
    ),
    tags: has('tags') && (
      <FieldRow label="Tags" align="start" onRemove={() => removeOn('tags')}>
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {sortedTags.map((t) => {
              const selected = seedTags.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  // Toggling on appends: the last tag picked is the one that paints.
                  onClick={() => setSeedTags((prev) => (selected ? prev.filter((id) => id !== t.id) : [...prev, t.id]))}
                  className="chip"
                  data-selected={selected || undefined}
                >
                  <Icon name={t.icon} size="0.875rem" className={COLOR_CLASSES[t.color].text} />
                  {t.name}
                </button>
              );
            })}
            <button type="button" onClick={() => setNewTagOpen((v) => !v)} className="chip">
              New…
            </button>
          </div>
          {newTagOpen && (
            <div className={cn(FIELD_ROW, 'flex-col items-stretch gap-1.5')}>
              <input
                autoFocus
                placeholder="Tag name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createTag();
                  }
                }}
                className="field-input"
              />
              <ColorPicker value={newTagColor} onChange={(k) => setNewTagColor(k ?? DEFAULT_COLOR)} />
              <div className="flex flex-wrap gap-1">
                {TAG_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    title={icon}
                    aria-pressed={newTagIcon === icon}
                    onClick={() => setNewTagIcon(icon)}
                    className={cn(
                      'icon-btn',
                      newTagIcon === icon && `border-accent ${COLOR_CLASSES[newTagColor].text}`,
                    )}
                  >
                    <Icon name={icon} size="1rem" />
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={createTag} disabled={!newTagName.trim()} className="self-start">
                Add
              </Button>
            </div>
          )}
        </div>
      </FieldRow>
    ),
    location: has('location') && (
      <FieldRow label="Where" onRemove={() => removeOn('location')}>
        <input
          placeholder="Room, address or link"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="field-input flex-1"
        />
      </FieldRow>
    ),
    remind: has('remind') && (
      <FieldRow label="Remind" align="start" onRemove={() => removeOn('remind')}>
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set([...REMINDER_QUICK, ...Object.keys(reminders).map(Number)]))
              .sort((a, b) => a - b)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    setReminders((prev) => {
                      const next = { ...prev };
                      if (next[m]) delete next[m];
                      else next[m] = true;
                      return next;
                    })
                  }
                  className="chip border-solid"
                  data-selected={reminders[m] || undefined}
                >
                  {reminderLabel(m, 'short')}
                </button>
              ))}
            <button
              type="button"
              onClick={() => setCustomRemOpen((v) => !v)}
              className="chip"
              data-selected={customRemOpen || undefined}
            >
              + Custom…
            </button>
          </div>
          {customRemOpen && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <input
                type="number"
                min="1"
                aria-label="Reminder lead time"
                className="field-input w-16 text-center"
                value={customRemAmount}
                onChange={(e) => setCustomRemAmount(e.target.value)}
                placeholder="15"
              />
              <Select options={[...LEAD_UNITS]} value={customRemUnit} onChange={setCustomRemUnit} />
              <Button
                size="sm"
                onClick={() => {
                  const n = Number.parseInt(customRemAmount, 10);
                  if (!Number.isFinite(n) || n <= 0) return;
                  const mult = LEAD_UNITS.find((u) => u.value === customRemUnit)?.mult ?? 1;
                  setReminders((prev) => ({ ...prev, [n * mult]: true }));
                  setCustomRemOpen(false);
                }}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </FieldRow>
    ),
    notes: has('notes') && (
      <FieldRow label="Notes" align="start" onRemove={() => removeOn('notes')}>
        <textarea
          placeholder="Details, links…"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="field-input flex-1 resize-y leading-normal"
        />
      </FieldRow>
    ),
  };

  // Delete asks inside the footer rather than in a second dialog stacked on
  // this one; a repeating seed is the only case with more than one answer.
  const footer = confirm ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">
        {recurring ? 'This repeats.' : hasHistory ? 'Delete it and its history?' : 'Delete?'}
      </span>
      {recurring ? (
        <>
          {editDate && (
            <>
              {edit?.repeat.type === 'every' && (
                <Button variant="ghost" className={DANGER} onClick={deleteJustThis}>
                  Just this · {shortDate(editDate)}
                </Button>
              )}
              <Button variant="ghost" className={DANGER} onClick={deleteFuture}>
                This and future
              </Button>
            </>
          )}
          <Button variant="ghost" className={DANGER} onClick={deleteItem}>
            All
          </Button>
        </>
      ) : (
        <Button variant="ghost" className={DANGER} onClick={deleteItem}>
          Delete
        </Button>
      )}
      <Button variant="ghost" onClick={() => setConfirm(false)}>
        Keep
      </Button>
    </div>
  ) : (
    <>
      {edit ? (
        <Button variant="ghost" className={DANGER} onClick={() => setConfirm(true)}>
          Delete
        </Button>
      ) : (
        <span className="text-xs text-icon-idle max-md:hidden">{canSubmit ? 'Enter to save' : ''}</span>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {edit ? 'Save' : 'Add'}
        </Button>
      </div>
    </>
  );

  // The date is clearable ("anytime") only for a to-do; an event or a repeating seed needs one.
  const clearable = doable && !repeating;

  return (
    <ModalChrome title={edit ? 'Edit' : 'New'} onClose={dismiss} cardRef={cardRef} innerRef={innerRef} footer={footer}>
      {/* Two panes on the desktop: the seed's concrete details on the left, the options menu on the right.
          Below `md` the aside is gone and a strip of `+` chips does that job. */}
      <div className="flex max-md:flex-col">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-[0.875rem] px-5 pt-[1.125rem] pb-1">
            {/* Title row: the doable checkbox, the colour dot, the title, the star */}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={doable}
                onCheckedChange={(v) => setDoableAndPrune(v === true)}
                aria-label="Can be ticked off"
                title={doable ? 'Can be ticked off' : 'Just on the calendar'}
              />
              <ColorPopover
                open={colorOpen}
                onOpenChange={setColorOpen}
                value={color}
                onChange={(key) => {
                  setColor(key);
                  setColorOpen(false);
                }}
                allowAuto
                auto={autoColor}
              >
                <button
                  type="button"
                  aria-label="Colour"
                  title={color ? 'Colour' : 'Colour (automatic)'}
                  onClick={() => setColorOpen((v) => !v)}
                  className="icon-btn shrink-0"
                >
                  <Dot color={color ?? autoColor} size={14} />
                </button>
              </ColorPopover>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                // A touch keyboard covering half the sheet, or an edit whose text
                // is already what the user wants, is not worth stealing focus for.
                autoFocus={!edit && !coarse}
                placeholder={PLACEHOLDER}
                className="w-full min-w-0 flex-1 border-0 border-b-2 border-line bg-transparent pt-1 pb-2 text-lg font-medium text-ink transition-colors duration-150 placeholder:text-ink-muted focus:border-accent"
              />
              <StarButton important={important} onToggle={() => setImportant((v) => !v)} size="1.25rem" />
            </div>

            {/* Appears the moment a date/time phrase is recognised in the title,
            disappears the moment it's applied (the phrase is stripped) or dismissed. */}
            {suggestion && (
              <NlDateSuggestion
                suggestion={suggestion}
                onApply={() => applySuggestion(suggestion)}
                onDismiss={dismissSuggestion}
                className={cn(FIELD_ROW, '-mt-2')}
              />
            )}

            {/* When: always shown. The time and the end join it as options. */}
            <div className={cn(FIELD_ROW, 'flex-col items-stretch gap-2 p-3 bg-page border border-line')}>
              <div className="flex flex-wrap items-center gap-[0.625rem]">
                <span className="micro-label w-[2.875rem] shrink-0">{clearable ? 'Due' : 'When'}</span>
                <DateField
                  className="flex-1 min-w-[8rem]"
                  aria-label="Date"
                  value={date}
                  allowEmpty={clearable}
                  placeholder={clearable ? 'anytime' : undefined}
                  onChange={(next) => {
                    // Moving the start drags the end with it, keeping the gap.
                    if (next && date && has('ends')) setEndDate(movedEnd(date, next, endDate));
                    setDate(next);
                    setDateTouched(true);
                  }}
                />
                {has('time') && timeInput('Start time', time, setTime)}
              </div>
              {has('ends') && (
                <div className="flex flex-wrap items-center gap-[0.625rem]">
                  <span className="micro-label w-[2.875rem] shrink-0">Ends</span>
                  <DateField
                    className="flex-1 min-w-[8rem]"
                    aria-label="End date"
                    value={endDate}
                    onChange={(next) => {
                      setEndDate(next);
                      setDateTouched(true);
                    }}
                  />
                  {has('time') && timeInput('End time', endTime, setEndTime)}
                </div>
              )}
            </div>

            {options.map((o) => (
              <Fragment key={o.key}>{rows[o.key]}</Fragment>
            ))}

            {/* Phone: the options not yet on, as `+` chips. */}
            <div className="hidden max-md:flex flex-wrap gap-1.5">
              {options
                .filter((o) => !has(o.key))
                .map((o) => (
                  <button key={o.key} type="button" onClick={() => toggleField(o.key)} className="chip">
                    + {o.label}
                  </button>
                ))}
            </div>

            {error && <p className="form-message text-danger">{error}</p>}
          </div>
        </div>

        <aside className="w-[14rem] shrink-0 border-l border-line px-5 pt-[1.125rem] pb-4 max-md:hidden">
          <div className="micro-label pb-2">Options</div>
          {options.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-ink">
              <Checkbox checked={has(o.key)} onCheckedChange={() => toggleField(o.key)} />
              {o.label}
            </label>
          ))}
        </aside>
      </div>
    </ModalChrome>
  );
}
