import { Icon } from '../ui/icon';
import { cn } from '@/lib/utils';
import InlineEditor from '../InlineEditor';
import { shortDate } from '../../dates';
import { REMINDER_CHOICES } from '../../reminders';
import { kindLabel } from '../../seedLogic';
import { BulkNotice, DeleteConfirm } from '../bulk/BulkControls';
import { plural } from '../bulk/useBulkActions';
import TagChips from './TagChips';
import type { SearchState } from './useSearchState';

const SECTION = 'micro-label';
const STEP_BTN =
  'size-[1.625rem] flex items-center justify-center border border-line text-ink-secondary transition-colors hover:border-accent hover:text-accent';
const LIST_BTN = 'flex items-center gap-2 px-2 py-1 text-xs font-medium hover:bg-subtle';

/**
 * The right-hand column that appears once something is selected: what's
 * selected, and the edits that make sense in bulk — list, tags, a date
 * shift, a reminder, deletion. One selected item also gets the door to the
 * full editor. On a phone it stacks under the results instead.
 */
export default function EditPanel({ s }: { s: SearchState }) {
  const items = s.selectedItems;
  const one = items.length === 1 ? items[0] : null;

  const byKind = items.reduce<Record<string, number>>((acc, i) => {
    const k = kindLabel(i.seed);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const subline = one
    ? [kindLabel(one.seed), one.listName, one.date ? shortDate(one.date) : null].filter(Boolean).join(' · ')
    : Object.entries(byKind)
        .map(([k, n]) => plural(n, k))
        .join(' · ');

  return (
    <aside className="flex w-[17.5rem] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-hover max-md:max-h-[55%] max-md:w-full max-md:border-t max-md:border-l-0">
      <div className="flex items-start justify-between gap-3 border-b border-line px-[0.875rem] pt-3 pb-2">
        <div className="min-w-0">
          <div className="truncate font-heading text-[0.8125rem] font-bold text-ink">
            {one ? one.title : `${items.length} selected`}
          </div>
          <div className="text-micro text-ink-muted">{subline}</div>
          {s.missingCount > 0 && (
            <div className="text-micro text-accent-deep">{s.missingCount} selected not in this result set</div>
          )}
        </div>
        <button
          type="button"
          onClick={s.clearSelection}
          className="shrink-0 text-micro font-medium text-ink-secondary hover:text-ink hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-[0.875rem] pt-2.5 pb-3">
        {one && <InlineEditor seed={one.seed} onAdvanced={s.openFullEditor} />}

        <section className="flex flex-col gap-1">
          <h4 className={SECTION}>List</h4>
          <button type="button" onClick={() => s.applyList('')} className={cn(LIST_BTN, 'text-ink-secondary')}>
            <span className="size-2 border border-line-strong" aria-hidden />
            <span className="flex-1 text-left">None</span>
            {s.commonList === '' && <Icon name="check" size="0.75rem" className="text-accent" />}
          </button>
          {s.listOptions.map((l) => (
            <button key={l.id} type="button" onClick={() => s.applyList(l.id)} className={cn(LIST_BTN, 'text-ink')}>
              <span className="flex-1 truncate text-left">{l.name}</span>
              {s.commonList === l.id && <Icon name="check" size="0.75rem" className="text-accent" />}
            </button>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className={SECTION}>Tags</h4>
          <TagChips
            tags={s.tagOptions}
            stateOf={(id) => {
              const n = items.filter((i) => i.seed.tags.includes(id)).length;
              return n === 0 ? 'off' : n === items.length ? 'on' : 'some';
            }}
            onToggle={s.applyTag}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className={SECTION}>
            Shift dates{s.datedCount < items.length && ` · ${s.datedCount} of ${items.length} have dates`}
          </h4>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Shift earlier" onClick={() => s.applyShift(-1)} className={STEP_BTN}>
              <Icon name="chevron_left" size="0.8125rem" />
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
              <Icon name="chevron_right" size="0.8125rem" />
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
                  'whitespace-nowrap border px-[0.4375rem] py-[0.1875rem] text-micro font-medium transition-colors',
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
          <DeleteConfirm n={items.length} onDelete={s.applyDelete} className="w-full" />
        </div>
      </div>

      <BulkNotice notice={s.notice} className="px-[0.875rem] py-2 text-micro" />
    </aside>
  );
}
