export const inputClass = 'w-full bg-white/10 border border-white/20 rounded-lg px-sm py-xs text-body-sm text-inverse-on-surface placeholder-outline-variant/60 focus:outline-none focus:border-primary-fixed-dim transition-colors';
export const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-outline-variant mb-xs';

export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-white/10 rounded-lg p-xs">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-xs px-xs rounded text-label-md font-semibold transition-all ${
            value === opt.value ? 'bg-primary text-on-primary shadow-sm' : 'text-outline-variant hover:text-on-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker<T extends string>({ value, onChange, colors }: {
  value: T;
  onChange: (c: T) => void;
  colors: Record<T, { hex: string }>;
}) {
  return (
    <div className="flex gap-sm">
      {(Object.keys(colors) as T[]).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`flex-1 h-9 rounded-lg transition-all ${
            value === c ? 'ring-2 ring-white/60 scale-105' : 'opacity-50 hover:opacity-80'
          }`}
          style={{ backgroundColor: colors[c].hex }}
        />
      ))}
    </div>
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
