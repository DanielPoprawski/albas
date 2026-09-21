import { type ReactNode, useId, useRef } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { CATEGORY_PALETTE, colorHex, PALETTE } from '../../colors';
import { useIsMobile } from '../../useMedia';
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
      className={`aspect-square transition-all ${
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
      className={`aspect-square relative transition-all ${
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
      {!isCustom && <span className="absolute inset-[30%] bg-surface" />}
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
 * row or the new-category swatch. Controlled by the caller, so the menu's
 * "Color" item and the swatch button can both open it.
 */
export function ColorPopover({
  open,
  onOpenChange,
  value,
  onChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (hex: string) => void;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverContent align="start" className="w-auto">
        <ColorPicker value={value} onChange={onChange} />
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
