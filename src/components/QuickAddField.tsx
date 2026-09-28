import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/icon';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { buildCreate } from '../createItem';
import InlineEditor from './InlineEditor';
import { fmt } from '../dates';
import { parseWhen, stripMatch } from '../nlDate';
import AddModal from './AddModal';

/** The surface the field sits on — a preset of defaults, not a type of its own. */
type Kind = 'event' | 'task' | 'habit';

const PLACEHOLDER: Record<Kind, string> = {
  event: 'New event… ("dentist tue 3pm", "trip sun to thu")',
  task: 'New task… ("call mom tomorrow")',
  habit: 'New habit…',
};

/**
 * The one-line way to add something: type a title (with a date phrase, if
 * any) and press Enter. This is the create control on every list surface,
 * phone and desktop alike — there is no floating "+". The trailing icon
 * opens the full modal with whatever was typed already in the title, for
 * the fields a line can't carry (reminders, repeat rules). What was just
 * added stays open in an inline editor under the field — list, colour, star,
 * date — until Escape, a click elsewhere, or the next add.
 *
 * An event with a parsed time is an hour long unless a range was given; one
 * without a time is all-day, so "trip sun to thu" lands as a four-day bar.
 */
export default function QuickAddField({
  kind,
  defaultList,
  className,
  variant = 'field',
}: {
  kind: Kind;
  /** Pre-assign a list id (e.g. a list's own header). */
  defaultList?: string;
  className?: string;
  /**
   * `field` is the bordered input box. `row` restyles the same control as the
   * last row of a bordered list (the Habits page): a dashed square where the
   * row's checkbox would be, which turns solid accent while typing.
   */
  variant?: 'field' | 'row';
}) {
  const { addSeed, selectedDate, seeds } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The seed just created, looked up live so the editor reflects its edits.
  const editing = lastId ? seeds.find((s) => s.id === lastId) : undefined;

  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setLastId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [editing]);

  const doable = kind !== 'event';
  const repeating = kind === 'habit';

  function submit() {
    const raw = text.trim();
    if (!raw) return;
    const when = parseWhen(raw);
    const stripped = when ? stripMatch(raw, when.matched) : raw;
    const title = stripped || raw;
    const today = fmt(new Date());
    // An event lands on the selected day; a to-do stays undated unless a
    // phrase dated it; a habit anchors on today.
    const date = when?.start.date ?? (kind === 'event' ? (selectedDate ?? today) : kind === 'habit' ? today : null);
    const created = addSeed(
      buildCreate(title, {
        doable,
        date,
        time: when?.start.time ?? null,
        endDate: when?.end?.date,
        endTime: when?.end?.time ?? null,
        repeat: repeating ? { type: 'every', n: 1, unit: 'day' } : undefined,
        list: defaultList,
      }),
    );
    setLastId(created.id);
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
            <Icon name="add" size="0.8125rem" />
          </span>
        ) : (
          <Icon name="add" size="0.875rem" className="text-ink-muted" />
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
          placeholder={PLACEHOLDER[kind]}
          aria-label={PLACEHOLDER[kind].split('…')[0]}
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
          <Icon name="tune" size="0.875rem" />
        </button>
        {open && (
          <AddModal
            defaultDoable={doable}
            defaultRepeating={repeating}
            defaultTitle={text}
            defaultList={defaultList}
            onSubmit={() => setText('')}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
      {editing && <InlineEditor seed={editing} onAdvanced={() => setOpen(true)} className="px-3 py-2" />}
    </div>
  );
}
