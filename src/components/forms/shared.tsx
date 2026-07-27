import { useRef } from 'react';
import { colorHex, PALETTE } from '../../colors';

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

export function Select<T extends string>({ options, value, onChange, className }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      className={`${inputClass} cursor-pointer ${className ?? ''}`}
      style={{ colorScheme: 'dark' }}
      value={value}
      onChange={e => onChange(e.target.value as T)}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

/** Swatch palette plus a rainbow "wheel" swatch that opens the native color picker. */
export function ColorPicker({ value, onChange }: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const customRef = useRef<HTMLInputElement>(null);
  const hex = colorHex(value);
  const isCustom = !PALETTE.includes(hex);

  return (
    <div className="flex flex-wrap gap-xs items-center">
      {PALETTE.map(c => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-full transition-all ${
            hex === c ? 'ring-2 ring-txt/70 ring-offset-2 ring-offset-transparent scale-110' : 'opacity-60 hover:opacity-100 hover:scale-105'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      <button
        type="button"
        title="Custom color"
        onClick={() => customRef.current?.click()}
        className={`w-7 h-7 rounded-full relative transition-all ${
          isCustom ? 'ring-2 ring-txt/70 scale-110' : 'opacity-80 hover:opacity-100 hover:scale-105'
        }`}
        style={{
          background: isCustom
            ? hex
            : 'conic-gradient(#ef4444, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
        }}
      >
        {!isCustom && (
          <span className="absolute inset-[9px] rounded-full bg-elevated" />
        )}
      </button>
      <input
        ref={customRef}
        type="color"
        className="sr-only"
        value={hex}
        onChange={e => onChange(e.target.value)}
        tabIndex={-1}
      />
    </div>
  );
}

export function CheckboxRow({ checked, onChange, label, hint }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-sm cursor-pointer p-sm rounded-lg bg-fill hover:bg-fill-strong transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 accent-blue-600"
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
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
        Delete
      </button>
      <SubmitButton label={saveLabel} />
    </div>
  );
}
