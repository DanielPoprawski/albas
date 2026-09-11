import { Fragment, type ReactNode } from 'react';

/**
 * Renders `text` with `ranges` (from `searchMatch.ts#buildMatcher(...).ranges`)
 * wrapped in `<mark>` — the search bar's "show me where it matched" highlight.
 * Ranges are assumed sorted and non-overlapping (which `ranges()` guarantees).
 */
export default function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>);
    parts.push(<mark key={`m${i}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);

  return <>{parts}</>;
}
