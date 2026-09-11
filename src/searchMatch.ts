/**
 * The one place that turns a search-bar query into a matcher. Used by
 * `SearchBar` to both filter hits and produce the `<mark>` ranges
 * `Highlighted` draws.
 *
 * Two modes:
 *  - plain (default): case-insensitive substring, the query escaped so any
 *    regex-special characters in it are matched literally.
 *  - regex: the query is compiled with `new RegExp`. Entered two ways, both
 *    supported at once — a `/pattern/flags` literal typed directly, or the
 *    bar's `.*` toggle forcing the raw text through as a pattern. `i` is
 *    added automatically unless the query's own flags already say otherwise;
 *    matching itself always runs with `g` (regardless of what the caller
 *    passed) so `ranges()` can walk every occurrence.
 */

export interface Matcher {
  ok: true;
  test(s: string): boolean;
  /** Every non-overlapping match in `s`, as `[start, end)` pairs. */
  ranges(s: string): [number, number][];
}

export interface MatcherError {
  ok: false;
  error: string;
}

/** `/pattern/flags` — the literal form recognised in the query text itself. */
const REGEX_LITERAL = /^\/(.*)\/([a-z]*)$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(query: string, opts: { regex: boolean }): Matcher | MatcherError {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, test: () => false, ranges: () => [] };

  let pattern: string;
  let flags: string;

  const literal = REGEX_LITERAL.exec(trimmed);
  if (literal) {
    pattern = literal[1];
    flags = literal[2];
  } else if (opts.regex) {
    pattern = trimmed;
    flags = '';
  } else {
    pattern = escapeRegExp(trimmed);
    flags = '';
  }

  if (!flags.includes('i')) flags += 'i';
  // Matching always needs `g` to walk every occurrence, whatever the caller asked for.
  const globalFlags = flags.includes('g') ? flags : `${flags}g`;

  let re: RegExp;
  try {
    re = new RegExp(pattern, globalFlags);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return {
    ok: true,
    test(s: string) {
      re.lastIndex = 0;
      return re.test(s);
    },
    ranges(s: string) {
      const out: [number, number][] = [];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const start = m.index;
        const end = Math.min(start + Math.max(m[0].length, 1), s.length);
        out.push([start, end]);
        // Zero-length match (e.g. `/a*/`): exec() won't advance on its own,
        // so force it forward by hand to avoid looping in place forever.
        if (re.lastIndex <= start) re.lastIndex = start + 1;
      }
      return out;
    },
  };
}

/** True when `query` looks like a `/pattern/flags` literal, for the toggle's auto-active state. */
export function isRegexLiteral(query: string): boolean {
  return REGEX_LITERAL.test(query.trim());
}
