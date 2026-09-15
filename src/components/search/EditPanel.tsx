import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorHex } from '../../colors';
import InlineEditor, { InlineEventEditor } from '../InlineEditor';
import { shortDate } from '../../dates';
import { REMINDER_CHOICES } from '../../reminders';
import { KIND_LABEL } from './searchItems';
import type { SearchState } from './useSearchState';

const SECTION = 'text-[0.625rem] font-bold uppercase tracking-[0.5px] text-ink-muted';
const STEP_BTN =
  'size-[1.625rem] flex items-center justify-center border border-line text-ink-secondary transition-colors hover:border-accent hover:text-accent';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The right-hand column that appears once something is selected: what's
 * selected, and the edits that make sense in bulk — category, a date
 * shift, a reminder, deletion. One selected item also gets the door to the
 * full editor.
 */
export default function EditPanel({ s }: { s: SearchState }) {
  const items = s.selectedItems;
  const one = items.length === 1 ? items[0] : null;

  const byKind = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1;
    return acc;
  }, {});
  const subline = one
    ? [KIND_LABEL[one.kind], one.categoryName, one.date ? shortDate(one.date) : null].filter(Boolean).join(' · ')
    : Object.entries(byKind)
        .map(([k, n]) => plural(n, KIND_LABEL[k as keyof typeof KIND_LABEL]))
        .join(' · ');

  return (
    <aside className="flex w-[17.5rem] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-hover">
      <div className="flex items-start justify-between gap-3 border-b border-line px-[0.875rem] pt-3 pb-2">
        <div className="min-w-0">
          <div className="truncate font-heading text-[0.8125rem] font-bold text-ink">
            {one ? one.title : `${items.length} selected`}
          </div>
          <div className="text-[0.6875rem] text-ink-muted">{subline}</div>
          {s.missingCount > 0 && (
            <div className="text-[0.6875rem] text-accent-deep">{s.missingCount} selected not in this result set</div>
          )}
        </div>
        <button
          type="button"
          onClick={s.clearSelection}
          className="shrink-0 text-[0.6875rem] font-medium text-ink-secondary hover:text-ink hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-[0.875rem] pt-2.5 pb-3">
        {one &&
          (one.kind === 'event' ? (
            <InlineEventEditor event={one.event} onAdvanced={s.openFullEditor} />
          ) : (
            <InlineEditor todo={one.todo} onAdvanced={s.openFullEditor} />
          ))}

        <section className="flex flex-col gap-1">
          <h4 className={SECTION}>Category</h4>
          <button
            type="button"
            onClick={() => s.applyCategory('')}
            className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-subtle"
          >
            <span className="size-2 border border-line-strong" aria-hidden />
            <span className="flex-1 text-left">None</span>
            {s.commonCategory === '' && <Check size="0.75rem" className="text-accent" />}
          </button>
          {s.categoryOptions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => s.applyCategory(c.id)}
              className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-ink hover:bg-subtle"
            >
              <span
                className="size-2"
                aria-hidden
                // dynamic: the category's own colour
                style={{ background: colorHex(c.colorKey) }}
              />
              <span className="flex-1 truncate text-left">{c.name}</span>
              {s.commonCategory === c.id && <Check size="0.75rem" className="text-accent" />}
            </button>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className={SECTION}>
            Shift dates{s.datedCount < items.length && ` · ${s.datedCount} of ${items.length} have dates`}
          </h4>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Shift earlier" onClick={() => s.applyShift(-1)} className={STEP_BTN}>
              <ChevronLeft size="0.8125rem" />
            </button>
            <input
              type="number"
              min={1}
              value={s.shiftN}
              onChange={(e) => s.setShiftN(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Days to shift"
              className="field-input h-[1.625rem] w-11 px-1 py-0 text-center text-xs"
            />
            <button type="button" aria-label="Shift later" onClick={() => s.applyShift(1)} className={STEP_BTN}>
              <ChevronRight size="0.8125rem" />
            </button>
            <span className="text-xs text-ink-secondary">days</span>
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className={SECTION}>Reminder</h4>
          <div className="flex flex-wrap gap-1">
            {REMINDER_CHOICES.map((r) => (
              <button
                key={String(r.value)}
                type="button"
                onClick={() => s.applyReminder(r.value)}
                className={cn(
                  'whitespace-nowrap border px-[0.4375rem] py-[0.1875rem] text-[0.6875rem] font-medium transition-colors',
                  s.commonReminder === r.value
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-line text-ink-secondary hover:border-accent hover:text-accent',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-auto pt-2">
          {s.confirmDelete ? (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-ink">Delete {plural(items.length, 'item')}?</span>
              <button type="button" onClick={s.applyDelete} className="font-bold text-danger hover:underline">
                Yes
              </button>
              <button
                type="button"
                onClick={() => s.setConfirmDelete(false)}
                className="text-ink-secondary hover:underline"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => s.setConfirmDelete(true)}
              className="button-small button-danger w-full"
            >
              Delete {plural(items.length, 'item')}
            </button>
          )}
        </div>
      </div>

      {s.notice && (
        <div className="border-t border-accent-line bg-selection px-[0.875rem] py-2 text-[0.6875rem] font-semibold text-selection-ink">
          {s.notice}
        </div>
      )}
    </aside>
  );
}
