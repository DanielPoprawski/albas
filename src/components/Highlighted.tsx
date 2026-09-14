import { Fragment } from 'react';
import { toParts } from '../searchMatch';

/**
 * Renders `text` with the matched character `positions` (from
 * `searchMatch.ts#matchItem`) wrapped in `<mark>` — the search palette's
 * "show me where it matched" highlight. Fuzzy matches scatter single
 * characters; regex matches come as runs. Either way `toParts` merges
 * neighbours so each run is one element.
 */
export default function Highlighted({ text, positions }: { text: string; positions: number[] | undefined }) {
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
