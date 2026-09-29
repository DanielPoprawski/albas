import { type ReactNode, useId } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { COLOR_CLASSES, COLOR_KEYS, COLOR_LABELS, DEFAULT_COLOR } from '../../colors';
import type { ColorKey } from '../../types';
import { cn } from '@/lib/utils';
import { Checkbox } from '../ui/checkbox';
import { PopoverContent } from '../ui/popover';
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/* The shared text-input skin: the `field-input` utility (App.css), which bakes in its own `:focus` border. */
export const inputClass = 'field-input';

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
          <SelectItem key={opt.value} value={opt.value} className="text-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

/**
 * Colour picker: the twelve `ColorKey`s, plus an "Auto" cell when the caller
 * allows null (a seed inheriting its last tag's colour). Two rows of seven
 * fixed-size cells — a finger's width on a phone — since a popover sized to
 * its content gives unsized grid tracks nothing to stretch into.
 */
export function ColorPicker({
  value,
  onChange,
  allowAuto,
  auto,
}: {
  value: ColorKey | null;
  onChange: (key: ColorKey | null) => void;
  /** Offer the Auto cell (value null). */
  allowAuto?: boolean;
  /** What Auto currently resolves to, drawn in the Auto cell. */
  auto?: ColorKey;
}) {
  const cell = (key: ColorKey | null, label: string, paint: ColorKey) => (
    <button
      key={key ?? 'auto'}
      type="button"
      title={label}
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={cn(
        'size-8 max-md:size-10 border transition-all',
        COLOR_CLASSES[paint].bg,
        key === null ? 'border-dashed border-line-strong' : COLOR_CLASSES[paint].line,
        value === key
          ? 'ring-2 ring-ink/70 ring-offset-1 ring-offset-transparent scale-110'
          : 'opacity-70 hover:opacity-100 hover:scale-110',
      )}
    />
  );

  return (
    <div className="grid w-max grid-cols-7 items-center gap-1.5">
      {allowAuto && cell(null, 'Auto', auto ?? DEFAULT_COLOR)}
      {COLOR_KEYS.map((key) => cell(key, COLOR_LABELS[key], key))}
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
  // htmlFor works here because a <button type="button"> is a labelable element, so the whole
  // row still toggles the box the way the native input did
  const id = useId();

  return (
    <label
      htmlFor={id}
      className="flex items-start gap-sm cursor-pointer p-sm bg-subtle hover:bg-subtle-strong transition-colors"
    >
      {/* was `accent-blue-600` — a literal blue that ignored the theme accent */}
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="block text-sm text-ink font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A `ColorPicker` in a small panel anchored to whatever it wraps — a sidebar
 * row or the modal's colour dot. Controlled by the caller, so a menu item and
 * the swatch button can both open it.
 */
export function ColorPopover({
  open,
  onOpenChange,
  value,
  onChange,
  allowAuto,
  auto,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ColorKey | null;
  onChange: (key: ColorKey | null) => void;
  allowAuto?: boolean;
  auto?: ColorKey;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverContent align="start" className="w-auto">
        <ColorPicker value={value} onChange={onChange} allowAuto={allowAuto} auto={auto} />
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
