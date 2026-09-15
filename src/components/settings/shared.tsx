import { type ReactNode, useCallback, useState } from 'react';
import { errorMessage } from '@/lib/utils';
import { Card as UiCard } from '../ui/card';
import { FormMessage } from '../ui/field';

const SW_TH = 'micro-label border-b border-line px-2.5 py-2 text-left';
export const SW_TD = 'border-b border-subtle p-2.5 text-ink';
/** The hairline belongs *between* rows, so the last row drops it. */
export const SW_TR = 'last:[&>td]:border-b-0';
/** A muted inline text button ("Advanced", "Show recovery codes"). */
export const LINK_MUTED = 'cursor-pointer border-0 bg-transparent p-0 text-xs text-ink-muted underline hover:text-ink';
/** A flat inset row inside a card (the share lists). */
export const ROW_INSET = 'mb-1 flex items-center gap-3 bg-subtle px-2 py-1.5';

/** Where a card's one background action is: the shape every Settings card reports with. */
export type AsyncState =
  | { kind: 'idle' }
  | { kind: 'busy'; what?: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/**
 * One `AsyncState` and the way to drive it: `run` wraps a task as a single
 * busy → ok/error cycle, the string it resolves to being the success line
 * (nothing resolved = back to idle). `setState` is there for the rare
 * outcome `run` can't express, such as a warning after a success.
 */
export function useAsyncState() {
  const [state, setState] = useState<AsyncState>({ kind: 'idle' });
  const run = useCallback(async (what: string, task: () => Promise<string | undefined | void>) => {
    setState({ kind: 'busy', what });
    try {
      const message = await task();
      setState(message ? { kind: 'ok', message } : { kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: errorMessage(err) });
    }
  }, []);
  return { state, setState, run, busy: state.kind === 'busy' };
}

/** The message line under a card for its `AsyncState`; nothing while idle. */
export function AsyncMessage({ state }: { state: AsyncState }) {
  if (state.kind === 'busy') return state.what ? <FormMessage kind="busy">{state.what}</FormMessage> : null;
  if (state.kind === 'ok') return <FormMessage kind="success">{state.message}</FormMessage>;
  if (state.kind === 'error') return <FormMessage>{state.message}</FormMessage>;
  return null;
}

/** The Account & Sign-in credential table and the Sessions table: header row + `<tr className={SW_TR}>` children. */
export function SettingsTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} className={SW_TH}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** A muted full-width row: "Loading…", "No active sessions.". */
export function SettingsTableNote({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="text-ink-muted">
        {children}
      </td>
    </tr>
  );
}

export function Card({ title, span = false, children }: { title: string; span?: boolean; children: ReactNode }) {
  return (
    // `ui/card.tsx`'s Card for the surface (adds `shadow-card` over the old
    // shadowless `.settings-card`); the heading stays Settings' own flat
    // uppercase label (`.card-title`) rather than `CardHeader`'s
    // accent-tinted strip, which is a different card style used elsewhere.
    <UiCard className={span ? 'col-span-full p-6' : 'p-6'}>
      <h3 className="card-title">{title}</h3>
      {children}
    </UiCard>
  );
}

export function SettingItem({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-item">
      <div>
        <div className="setting-label">{label}</div>
        <div className="setting-desc">{description}</div>
      </div>
      {children}
    </div>
  );
}
