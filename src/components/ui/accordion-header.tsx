import { Plus } from 'lucide-react';

/**
 * The band above a collapsible category group (To-Do, Habits), painted in
 * the category's colour (the accent when it has none): a `+`/`-` glyph and
 * the name toggle it, a monospace count sits on the right. `onAdd` draws a
 * plus that creates into the group.
 */
export function AccordionHeader({
  name,
  color,
  count,
  open,
  onToggle,
  onAdd,
}: {
  name: string;
  /** The category's own hex; omit for the accent. */
  color?: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  return (
    <div
      className="flex items-center bg-accent text-on-accent select-none"
      // dynamic: the category's own colour
      style={color ? { backgroundColor: color } : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2 text-left"
      >
        <span aria-hidden className="font-mono text-sm font-bold leading-none">
          {open ? '-' : '+'}
        </span>
        <span className="text-xs font-bold tracking-wider uppercase truncate">{name}</span>
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add to ${name}`}
          title={`Add to ${name}`}
          className="flex items-center px-2 py-2 opacity-60 hover:opacity-100 transition-opacity"
        >
          <Plus size="0.875rem" strokeWidth={3} />
        </button>
      )}
      <span className="font-mono text-micro font-bold tracking-widest text-on-accent/75 tabular-nums pl-2 pr-4">
        {count}
      </span>
    </div>
  );
}
