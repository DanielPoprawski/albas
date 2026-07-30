import { useId, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { colorHex, GREY_RAMP, PALETTE, PALETTE_COMPACT, PALETTE_ROWS } from '../../colors';
import { useIsMobile } from '../../useMedia';
import { Checkbox } from '../ui/checkbox';
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

export const inputClass = 'w-full bg-fill-strong border border-fill-stronger rounded-lg px-sm py-xs text-body-sm text-txt placeholder-txt-muted/60 focus:outline-none focus:border-primary-fixed-dim transition-colors';
export const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-txt-muted mb-xs';

export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-fill-strong rounded-lg p-xs">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-xs px-xs rounded text-label-md font-semibold transition-all ${
            value === opt.value ? 'bg-primary text-on-primary shadow-sm' : 'text-txt-muted hover:text-txt'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Same props as the native `<select>` this used to render, so no call site
 * changed. The swap fixes a real bug: the old one hardcoded
 * `colorScheme: 'dark'`, which forced a dark OS dropdown even under the light
 * theme. The Radix listbox is styled from the theme tokens instead.
 */
export function Select<T extends string>({ options, value, onChange, className }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <SelectRoot value={value} onValueChange={v => onChange(v as T)}>
      <SelectTrigger className={`${inputClass} cursor-pointer h-auto ${className ?? ''}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value} className="text-body-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

/**
 * Colour picker. Two shapes for two amounts of room:
 *  - phone: a single row of seven hues plus the wheel, because a second row
 *    pushes the rest of the form off screen;
 *  - desktop: a 12x4 grid — three shade rows, then black→white, with the wheel
 *    occupying the last cell so the grid stays rectangular.
 *
 * The wheel opens the OS colour picker via a hidden `input[type=color]`, so any
 * hex is reachable; the swatches are just the fast path.
 */
export function ColorPicker({ value, onChange }: {
  value: string;
  onChange: (hex: string) => void;
}) {
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
          ? 'ring-2 ring-txt/70 ring-offset-1 ring-offset-transparent scale-110'
          : 'opacity-70 hover:opacity-100 hover:scale-110'
      }`}
      style={{ backgroundColor: c }}
    />
  );

  const wheel = (
    <button
      type="button"
      title="Custom colour"
      onClick={() => customRef.current?.click()}
      className={`aspect-square rounded-full relative transition-all ${
        isCustom ? 'ring-2 ring-txt/70 scale-110' : 'opacity-90 hover:opacity-100 hover:scale-110'
      }`}
      style={{
        background: isCustom
          ? hex
          : 'conic-gradient(#ef4444, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
      }}
    >
      {/* punched-out centre marks it as "pick anything", not a colour itself */}
      {!isCustom && <span className="absolute inset-[30%] rounded-full bg-elevated" />}
    </button>
  );

  const hidden = (
    <input
      ref={customRef}
      type="color"
      className="sr-only"
      value={hex}
      onChange={e => onChange(e.target.value)}
      tabIndex={-1}
    />
  );

  if (isMobile) {
    return (
      <div className="grid grid-cols-8 gap-xs items-center">
        {PALETTE_COMPACT.map(swatch)}
        {wheel}
        {hidden}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-1 items-center max-w-[22rem]">
      {PALETTE_ROWS.flat().map(swatch)}
      {GREY_RAMP.map(swatch)}
      {wheel}
      {hidden}
    </div>
  );
}

export function CheckboxRow({ checked, onChange, label, hint }: {
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
      className="flex items-start gap-sm cursor-pointer p-sm rounded-lg bg-fill hover:bg-fill-strong transition-colors"
    >
      {/* was `accent-blue-600` — a literal blue that ignored the theme accent */}
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={v => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-body-sm text-txt font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-txt-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="w-full py-sm bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all"
    >
      {label}
    </button>
  );
}

/** Submit row for edit forms: danger delete on the left, save filling the rest. */
export function EditActions({ saveLabel, onDelete }: { saveLabel: string; onDelete: () => void }) {
  return (
    <div className="flex gap-sm">
      <button
        type="button"
        onClick={onDelete}
        className="px-md py-sm rounded-lg font-semibold text-body-sm border text-danger hover:bg-tertiary-container/20 active:scale-95 transition-all flex items-center gap-xs flex-shrink-0"
        style={{ borderColor: 'color-mix(in srgb, var(--t-danger) 55%, transparent)' }}
      >
        <Trash2 size={15} />
        Delete
      </button>
      <SubmitButton label={saveLabel} />
    </div>
  );
}
