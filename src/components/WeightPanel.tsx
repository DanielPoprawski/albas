import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useApp, type NewWeight } from '../context/AppContext';
import { fmt, rotateWeek, shortDate } from '../dates';
import {
  currentMonthKey, displayWeight, monthLabel, monthlyRows, toStoredKg, weeklyRows,
} from '../weightLogic';
import { inputClass, labelClass } from './forms/shared';
import type { WeightUnit } from '../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtWeight(kg: number | null, unit: WeightUnit): string {
  if (kg == null) return '—';
  return displayWeight(kg, unit).toFixed(1);
}

function fmtPct(pct: number | null): string {
  return pct == null ? '—' : `${pct.toFixed(1)}%`;
}

/** Signed delta with an explicit sign, so a gain reads differently from a loss. */
function delta(current: number | null, previous: number | null, unit: WeightUnit): string | null {
  if (current == null || previous == null) return null;
  const d = displayWeight(current, unit) - displayWeight(previous, unit);
  if (Math.abs(d) < 0.05) return 'no change';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} ${unit} vs last week`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="flex-1 min-w-[9rem] p-md rounded-xl bg-fill">
      <div className="text-[10px] font-bold uppercase tracking-wider text-txt-muted">{label}</div>
      <div className="text-headline-lg font-bold text-txt mt-xs">{value}</div>
      {sub && <div className="text-[11px] text-txt-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default function WeightPanel() {
  const { weights, weightUnit, addWeight, deleteWeight, firstDayOfWeek } = useApp();
  const [adding, setAdding] = useState(false);

  const weeks = useMemo(() => weeklyRows(weights, firstDayOfWeek), [weights, firstDayOfWeek]);
  const months = useMemo(() => monthlyRows(weights), [weights]);

  const thisWeek = weeks[0] ?? null;
  const lastWeek = weeks[1] ?? null;
  const thisMonth = months.find(m => m.month === currentMonthKey()) ?? null;

  return (
    <div className="h-full overflow-auto scrollbar-hide">
      <div className="flex items-center justify-between mb-md">
        <h3 className="text-label-md text-txt-muted uppercase tracking-wider">Weight</h3>
        <button
          onClick={() => setAdding(v => !v)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-fill-strong text-txt-muted hover:bg-primary hover:text-on-primary transition-colors"
          title={adding ? 'Cancel' : 'Add a reading'}
        >
          {adding ? <X size={18} /> : <Plus size={18} />}
        </button>
      </div>

      {adding && <ManualEntry unit={weightUnit} onDone={() => setAdding(false)} onAdd={addWeight} />}

      {weights.length === 0 ? (
        <p className="text-body-sm text-txt-muted">
          No readings yet. Add one with the + button, or connect your Wyze scale in Settings.
        </p>
      ) : (
        <div className="space-y-lg">
          <div className="flex flex-wrap gap-sm">
            <Stat
              label="This week avg"
              value={`${fmtWeight(thisWeek?.avgKg ?? null, weightUnit)} ${weightUnit}`}
              sub={delta(thisWeek?.avgKg ?? null, lastWeek?.avgKg ?? null, weightUnit)}
            />
            <Stat
              label="This month avg BF"
              value={fmtPct(thisMonth?.avgBodyFat ?? null)}
              sub={thisMonth ? `${thisMonth.sampleCount} day${thisMonth.sampleCount === 1 ? '' : 's'} logged` : null}
            />
          </div>

          {/* Weekly table. Scrolls inside itself so the page never scrolls sideways. */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-txt-muted mb-sm">
              Weekly ({weightUnit})
            </h4>
            <div className="overflow-x-auto scrollbar-hide -mx-xs px-xs">
              <table className="w-full min-w-[34rem] border-collapse text-body-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-txt-muted">
                    <th className="text-left font-bold py-xs pr-sm whitespace-nowrap">Week of</th>
                    {rotateWeek(DAY_NAMES, firstDayOfWeek).map((d, i) => (
                      <th key={i} className="font-bold py-xs px-1 text-center">{d}</th>
                    ))}
                    <th className="font-bold py-xs pl-sm text-right whitespace-nowrap">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map(week => (
                    <tr key={week.weekStart} className="border-t border-line">
                      <td className="py-sm pr-sm text-txt-muted whitespace-nowrap">
                        {shortDate(week.weekStart)}
                      </td>
                      {week.days.map(cell => (
                        <td
                          key={cell.date}
                          className={`py-sm px-1 text-center tabular-nums ${
                            cell.weightKg == null ? 'text-txt-faint' : 'text-txt'
                          }`}
                        >
                          {fmtWeight(cell.weightKg, weightUnit)}
                        </td>
                      ))}
                      <td className="py-sm pl-sm text-right font-bold text-txt tabular-nums whitespace-nowrap">
                        {fmtWeight(week.avgKg, weightUnit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-txt-muted mb-sm">
              Monthly body fat
            </h4>
            <div className="space-y-xs">
              {months.map(m => (
                <div
                  key={m.month}
                  className="flex items-center justify-between p-sm rounded-lg bg-fill"
                >
                  <span className="text-body-sm text-txt">{monthLabel(m.month)}</span>
                  <span className="flex items-baseline gap-sm">
                    <span className="text-body-sm font-bold text-txt tabular-nums">
                      {fmtPct(m.avgBodyFat)}
                    </span>
                    <span className="text-[11px] text-txt-muted tabular-nums w-16 text-right">
                      {fmtWeight(m.avgKg, weightUnit)} {weightUnit}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <RecentList unit={weightUnit} onDelete={deleteWeight} />
        </div>
      )}
    </div>
  );
}

function RecentList({ unit, onDelete }: { unit: WeightUnit; onDelete: (id: string) => void }) {
  const { weights } = useApp();
  const recent = [...weights].sort((a, b) => b.ts - a.ts).slice(0, 10);

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-txt-muted mb-sm">
        Recent readings
      </h4>
      <div className="space-y-xs">
        {recent.map(w => (
          <div key={w.id} className="group flex items-center gap-sm p-sm rounded-lg hover:bg-fill">
            <span className="text-body-sm text-txt tabular-nums w-16">
              {fmtWeight(w.weightKg, unit)}
            </span>
            <span className="text-[11px] text-txt-muted tabular-nums w-14">{fmtPct(w.bodyFat)}</span>
            <span className="text-[11px] text-txt-muted flex-1">{shortDate(w.date)}</span>
            <span className="text-[10px] uppercase tracking-wider text-txt-faint">{w.source}</span>
            <button
              onClick={() => onDelete(w.id)}
              title="Delete reading"
              className="opacity-0 group-hover:opacity-100 text-txt-muted hover:text-danger transition-opacity"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualEntry({ unit, onAdd, onDone }: {
  unit: WeightUnit;
  onAdd: (w: NewWeight) => void;
  onDone: () => void;
}) {
  const todayStr = fmt(new Date());
  const [date, setDate] = useState(todayStr);
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');

  const parsed = Number(weight);
  const valid = weight.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  function submit() {
    if (!valid) return;
    const bf = Number(bodyFat);
    onAdd({
      date,
      // Noon local, so a reading can't land on the neighbouring day via timezone drift.
      ts: new Date(`${date}T12:00:00`).getTime(),
      weightKg: toStoredKg(parsed, unit),
      bodyFat: bodyFat.trim() !== '' && Number.isFinite(bf) ? bf : null,
      bmi: null,
      muscle: null,
      bodyWater: null,
      source: 'manual',
    });
    onDone();
  }

  return (
    <div className="p-md rounded-xl bg-fill mb-md">
      <div className="grid grid-cols-3 gap-sm">
        <div>
          <label className={labelClass}>Date</label>
          <input type="date" value={date} max={todayStr} onChange={e => setDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Weight ({unit})</label>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            placeholder="0.0"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Body fat %</label>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={bodyFat}
            onChange={e => setBodyFat(e.target.value)}
            placeholder="optional"
            className={inputClass}
          />
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!valid}
        className="w-full mt-md py-sm bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
      >
        Add reading
      </button>
    </div>
  );
}
