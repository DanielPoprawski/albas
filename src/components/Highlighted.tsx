import { Fragment, type ReactNode } from 'react';
import { toParts } from '../searchMatch';

/**
 * Renders `text` with the matched character `positions` (from
 * `searchMatch.ts#matchItem`) wrapped in `<mark>` — the search palette's
 * "show me where it matched" highlight. Fuzzy matches scatter single
 * characters; regex matches come as runs. Either way `toParts` merges
 * neighbours so each run is one element.
 */
export function Highlighted({ text, positions }: { text: string; positions: number[] | undefined }) {
  const parts = toParts(text, positions);
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        const key = `${i}:${p.text.length}`;
        return p.hit ? <mark key={key}>{p.text}</mark> : <Fragment key={key}>{p.text}</Fragment>;
      })}
    </>
  );
}

/** Renders `text` with each `{index, length}` run wrapped in a span of its own class; a run overlapping an earlier one is dropped. */
export function Marked({
  text,
  marks,
}: {
  text: string;
  marks: { index: number; length: number; className: string }[];
}) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.index - b.index)) {
    if (m.index < at) continue;
    out.push(text.slice(at, m.index));
    out.push(
      <span key={m.index} className={m.className}>
        {text.slice(m.index, m.index + m.length)}
      </span>,
    );
    at = m.index + m.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}
