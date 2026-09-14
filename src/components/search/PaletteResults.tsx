import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import Highlighted from '../Highlighted';
import { Checkbox } from '../ui/checkbox';
import { KIND_LABEL, MAX_HITS, dateLabel } from './searchItems';
import type { ScopeTab } from './types';
import type { SearchState } from './useSearchState';

const TABS: { id: ScopeTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'events', label: 'Events' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'habits', label: 'Habits' },
];

const LINK = 'text-[0.6875rem] font-medium text-ink-secondary hover:text-ink hover:underline';

function summaryText(s: SearchState): string {
  const total = s.tabMatches.length;
  if (s.plan.mode === 'regex' && !s.plan.ok) return "Pattern doesn't compile yet";
  const base =
    s.plan.mode === 'empty' ? `${total} item${total === 1 ? '' : 's'}` : `${total} match${total === 1 ? '' : 'es'}`;
  return total > MAX_HITS ? `${base} · showing ${MAX_HITS}` : base;
}

/** Scope tabs with live counts, the summary/select links, the rows, and the key legend. */
export default function PaletteResults({ s }: { s: SearchState }) {
  const list = useRef<HTMLUListElement>(null);

  // Keep the active row in view by nudging the list's own scroll — not
  // `scrollIntoView`, which would also scroll the page behind the overlay.
  useEffect(() => {
    const el = list.current;
    const row = el?.children[s.active] as HTMLElement | undefined;
    if (!el || !row) return;
    const top = row.offsetTop - el.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [s.active]);

  const tabName = TABS.find((t) => t.id === s.tab)?.label.toLowerCase() ?? '';

  return (
    <>
      <div className="flex items-center gap-4 border-b border-line px-[0.875rem]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={s.tab === t.id}
            onClick={() => s.setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 pt-2 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.5px] transition-colors',
              s.tab === t.id ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
            <span className="font-medium text-ink-muted tabular-nums">{s.counts[t.id]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-[0.6875rem] text-ink-muted">
          <span>{summaryText(s)}</span>
          <button type="button" className={LINK} onClick={s.selectAll}>
            Select all
          </button>
          {s.visibleSelectedCount > 0 && (
            <button type="button" className={LINK} onClick={s.deselectAll}>
              Deselect all
            </button>
          )}
        </div>
      </div>

      <ul ref={list} role="listbox" aria-label="Search results" className="flex-1 min-h-0 overflow-y-auto py-1.5">
        {s.hits.length === 0 && (
          <li className="px-[0.875rem] py-6 text-center text-[0.8125rem] text-ink-muted">
            {s.plan.mode === 'regex' && !s.plan.ok
              ? 'Finish the pattern to see matches.'
              : `Nothing matches “${s.query.trim()}” in ${tabName}.`}
          </li>
        )}
        {s.hits.map((hit, i) => {
          const { item } = hit;
          const isActive = i === s.active;
          const isSelected = s.selected.has(item.key);
          const second = [item.categoryName, item.kind === 'event' ? item.event.description : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={item.key}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => s.setActive(i)}
              onClick={() => s.primaryAction(item)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 border-l-2 py-2 pr-[0.875rem] pl-3',
                isActive ? 'border-accent bg-surface-hover' : 'border-transparent',
                isSelected && 'bg-accent-tint',
              )}
            >
              {item.selectable ? (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => s.toggleSelect(item)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${item.title}`}
                  className="size-4"
                />
              ) : (
                <span className="size-4 shrink-0" aria-hidden />
              )}
              <span
                className="size-2 shrink-0"
                aria-hidden
                // dynamic: the item's own colour
                style={{ background: item.color }}
              />
              <span className="flex-1 min-w-0">
                <span
                  className={cn(
                    'block truncate text-[0.8125rem] font-medium text-ink',
                    item.kind === 'task' &&
                      Object.values(item.todo.completions).some((v) => v >= item.todo.target) &&
                      'line-through opacity-55',
                  )}
                >
                  <Highlighted text={item.title} positions={hit.positions[0]} />
                </span>
                {second && (
                  <span className="block truncate text-[0.6875rem] text-ink-muted">
                    {item.categoryName && (
                      <Highlighted text={item.categoryName} positions={hit.positions[item.fields.length - 1]} />
                    )}
                    {item.categoryName && item.kind === 'event' && item.event.description && ' · '}
                    {item.kind === 'event' && item.event.description && (
                      <Highlighted text={item.event.description} positions={hit.positions[1]} />
                    )}
                  </span>
                )}
              </span>
              {item.hasReminder && <Bell size="0.75rem" className="shrink-0 text-accent" aria-label="Has a reminder" />}
              <span className="min-w-[5.75rem] shrink-0 text-right text-[0.6875rem] text-ink-secondary tabular-nums">
                {dateLabel(item, s.firstDayOfWeek)}
              </span>
              <span className="w-9 shrink-0 text-[0.5625rem] font-bold uppercase text-ink-muted">
                {KIND_LABEL[item.kind]}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-4 border-t border-line px-[0.875rem] py-2 text-[0.6875rem] text-ink-muted">
        <span>↑↓ move · ↵ open · ⇧↵ select · Ctrl+⇧A select all · Ctrl+⇧D deselect all</span>
        <span className="font-mono text-[0.625rem] whitespace-nowrap">
          'exact !exclude ^start end$ /regex/ cat:health
        </span>
      </div>
    </>
  );
}
