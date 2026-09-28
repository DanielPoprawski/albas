import { useEffect, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { bySort, GENERAL, isHabit, isRepeating, movedEnd } from '../seedLogic';
import type { ColorKey, Routine, Seed } from '../types';
import DateField from './forms/DateField';
import { ColorPopover, Select } from './forms/shared';
import { ROUTINE_OPTIONS } from './habits/habitModel';
import { Dot } from './ui/tag';
import { StarButton } from './ui/star';

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
  onCommit: (title: string) => void;
  autoFocus?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const title = draft.trim();
    if (!title) {
      setDraft(value);
      return;
    }
    if (title !== value) onCommit(title);
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

/** Stops a wrapping row's click/keyboard handlers from firing on edits made here. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Radix's Select treats '' as "nothing chosen", so the untagged routine gets a name of its own. */
const AUTO = 'auto';
const ROUTINE_CHOICES: { value: Routine | typeof AUTO; label: string }[] = [
  { value: AUTO, label: 'Auto' },
  ...ROUTINE_OPTIONS,
];

/** The seed's colour swatch: click to pick a key, or Auto to follow its last tag. */
function ColorSwatch({
  value,
  resolved,
  onChange,
}: {
  value: ColorKey | null;
  resolved: ColorKey;
  onChange: (key: ColorKey | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={value}
      auto={resolved}
      allowAuto
      onChange={(key) => {
        onChange(key);
        setOpen(false);
      }}
    >
      <button type="button" aria-label="Colour" title="Colour" onClick={() => setOpen((v) => !v)} className="icon-btn">
        <Dot color={resolved} size={12} />
      </button>
    </ColorPopover>
  );
}

/**
 * The light editor a list row, the search palette and quick-add show for a
 * single seed: title, colour, list, a habit's routine, star, and the day for
 * anything that doesn't repeat. Every change is written straight through
 * `updateSeed`; "Advanced…" hands off to the full modal.
 */
export default function InlineEditor({
  seed,
  autoFocusTitle,
  onAdvanced,
  className,
}: {
  seed: Seed;
  autoFocusTitle?: boolean;
  onAdvanced?: () => void;
  className?: string;
}) {
  const { updateSeed, lists, colorOf } = useApp();
  const listOptions = [
    { value: '', label: GENERAL },
    ...[...lists].sort(bySort).map((l) => ({ value: l.id, label: l.name })),
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} onClick={stop} onKeyDown={stop}>
      <TitleInput
        value={seed.title}
        onCommit={(title) => updateSeed(seed.id, { title })}
        autoFocus={autoFocusTitle}
        label="Title"
      />
      <ColorSwatch value={seed.color} resolved={colorOf(seed)} onChange={(color) => updateSeed(seed.id, { color })} />
      <Select
        options={listOptions}
        value={listOptions.some((o) => o.value === seed.list) ? seed.list : ''}
        onChange={(list) => updateSeed(seed.id, { list })}
        className="w-auto"
      />
      {isHabit(seed) && (
        <Select
          options={ROUTINE_CHOICES}
          value={seed.routine || AUTO}
          onChange={(routine) => updateSeed(seed.id, { routine: routine === AUTO ? '' : routine })}
          className="w-auto"
        />
      )}
      <StarButton important={seed.important} onToggle={() => updateSeed(seed.id, { important: !seed.important })} />
      {!isRepeating(seed) && (
        <DateField
          value={seed.date ?? ''}
          onChange={(date) => {
            // Keep a span's length when its start moves; a to-do may lose its date altogether.
            const next = date || null;
            const endDate = next && seed.date && seed.endDate ? movedEnd(seed.date, next, seed.endDate) : null;
            updateSeed(seed.id, { date: next, endDate });
          }}
          allowEmpty={!!seed.track}
          placeholder="No date"
          aria-label="Date"
          className="w-[9rem]"
        />
      )}
      <AdvancedButton onClick={onAdvanced} />
    </div>
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
