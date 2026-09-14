import { useId, useRef, type MutableRefObject } from 'react';
import { Trash2 } from 'lucide-react';
import { CATEGORY_PALETTE, colorHex, PALETTE } from '../../colors';
import { useIsMobile } from '../../useMedia';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Segmented } from '../ui/segmented';
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/*
 * The shared text-input skin — now just the `field-input` utility (App.css),
 * which bakes in its own `:focus` border so it no longer needs a
 * `focus:border-accent` modifier at the call site.
 */
export const inputClass = 'field-input';

/**
 * What a form's `commit()` did. The modal decides what each means for
 * closing: a dismiss (scrim, Escape, back) closes on anything but `invalid`,
 * the Done button additionally refuses `empty` so a blank title is noticed.
 */
export type CommitResult = 'saved' | 'unchanged' | 'empty' | 'invalid';
export type CommitRef = MutableRefObject<(() => CommitResult) | null>;
export const labelClass = 'micro-label block mb-xs';

/**
 * Re-export of `ui/segmented.tsx#Segmented` under this form's older name
 * (its two callers, EventForm and TodoForm, are untouched) — that one has
 * roving-arrow keyboard support this one never grew. Visual note: this
 * merge swaps a padded rounded-pill track (redundant anyway, since the
 * app-wide `border-radius: 0` reset already squared its corners off) for
 * the bordered adjoining-square look every other segmented control in the
 * app already uses (Settings' appearance rows).
 */
export const SegmentedControl = Segmented;

/**
 * Same props as the native `<select>` this used to render, so no call site
 * changed. The swap fixes a real bug: the old one hardcoded
 * `colorScheme: 'dark'`, which forced a dark OS dropdown even under the light
 * theme. The Radix listbox is styled from the theme tokens instead.
 */
export function Select<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <SelectRoot value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className={`${inputClass} cursor-pointer h-auto ${className ?? ''}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-body-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

/**
 * Colour picker: the 12 category hues plus the wheel. On a phone the same
 * thirteen cells wrap onto two rows of seven, since a 13-wide row is too
 * tight to tap; on desktop they sit in one row.
 *
 * The wheel opens the OS colour picker via a hidden `input[type=color]`, so any
 * hex is reachable; the swatches are just the fast path.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const customRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const hex = colorHex(value);
  const isCustom = !PALETTE.includes(hex);

  const swatch = (c: string) => (
    <button
      key={c}
      type="button"
      title={c}
      onClick={() => onChange(c)}
      className={`aspect-square rounded-full transition-all ${
        hex.toLowerCase() === c.toLowerCase()
          ? 'ring-2 ring-ink/70 ring-offset-1 ring-offset-transparent scale-110'
          : 'opacity-70 hover:opacity-100 hover:scale-110'
      }`}
      // dynamic: the swatch is the colour it offers
      style={{ backgroundColor: c }}
    />
  );

  const wheel = (
    <button
      type="button"
      title="Custom color"
      onClick={() => customRef.current?.click()}
      className={`aspect-square rounded-full relative transition-all ${
        isCustom ? 'ring-2 ring-ink/70 scale-110' : 'opacity-90 hover:opacity-100 hover:scale-110'
      }`}
      // dynamic: the wheel shows the custom colour once one is picked
      style={{
        background: isCustom
          ? hex
          : 'conic-gradient(#ef4444, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
      }}
    >
      {/* punched-out centre marks it as "pick anything", not a colour itself */}
      {!isCustom && <span className="absolute inset-[30%] rounded-full bg-surface" />}
    </button>
  );

  const hidden = (
    <input
      ref={customRef}
      type="color"
      className="sr-only"
      value={hex}
      onChange={(e) => onChange(e.target.value)}
      tabIndex={-1}
    />
  );

  return (
    <div className={cn('grid items-center', isMobile ? 'grid-cols-7 gap-xs' : 'grid-cols-13 gap-1 max-w-[22rem]')}>
      {CATEGORY_PALETTE.map(swatch)}
      {wheel}
      {hidden}
    </div>
  );
}

export function CheckboxRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  // htmlFor works here because a <button> is a labelable element, so the whole
  // row still toggles the box the way the native input did
  const id = useId();

  return (
    <label
      htmlFor={id}
      className="flex items-start gap-sm cursor-pointer p-sm rounded-lg bg-subtle hover:bg-subtle-strong transition-colors"
    >
      {/* was `accent-blue-600` — a literal blue that ignored the theme accent */}
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="block text-body-sm text-ink font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * `ui/button.tsx#Button` in its `primary` variant, which already draws from
 * `--t-accent` (not shadcn's neutral "accent" hover surface — see CLAUDE.md).
 * `active:scale-95` is kept as a press affordance the shared Button doesn't
 * have; `text-sm` replaces the old `text-body-sm` (0.875rem).
 */
export function SubmitButton({ label }: { label: string }) {
  return (
    <Button type="submit" variant="primary" className="w-full active:scale-95">
      {label}
    </Button>
  );
}

/** Submit row for edit forms: danger delete on the left, save filling the rest. */
export function EditActions({ saveLabel, onDelete }: { saveLabel: string; onDelete: () => void }) {
  return (
    <div className="flex gap-sm">
      <button
        type="button"
        onClick={onDelete}
        className="px-md py-sm font-semibold text-body-sm border border-danger/55 text-danger hover:bg-cat-red-tint active:scale-95 transition-all flex items-center gap-xs flex-shrink-0"
      >
        <Trash2 size="0.9375rem" />
        Delete
      </button>
      <SubmitButton label={saveLabel} />
    </div>
  );
}
