/**
 * The search palette's engine: query → matcher. Pure functions, no DOM, so
 * it could move to a Web Worker if the item count ever warranted it.
 *
 * Two modes, decided from the query text alone (there is no toggle button):
 *  - regex — a `/pattern/flags` literal, an unterminated `/pattern` prefix,
 *    or (opt-in via `autoRegex`) any query with metacharacters that compiles.
 *    `i` is added unless the flags say otherwise; matching always runs with
 *    `g` so every occurrence can be walked for highlighting.
 *  - fuzzy — everything else, fzf-style: space-separated terms are AND-ed,
 *    each scored with the fzf v2 algorithm (a Smith-Waterman-ish DP with
 *    boundary/camel/consecutive bonuses and gap penalties). Extended syntax:
 *    `'exact`  `!exclude`  `^prefix`  `suffix$`.
 *
 * Every match returns the matched character indices so the UI can highlight
 * in place (`toParts`).
 */

import { errorMessage } from '@/lib/utils';

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXT = -1;
const BONUS_BOUNDARY = 8;
const BONUS_BOUNDARY_WHITE = 10;
const BONUS_BOUNDARY_DELIM = 9;
const BONUS_NON_WORD = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 4;
const BONUS_FIRST_MULT = 2;

const C_WHITE = 0;
const C_NONWORD = 1;
const C_DELIM = 2;
const C_LOWER = 3;
const C_UPPER = 4;
const C_NUMBER = 5;
const NEG = -1e9;

export interface Term {
  text: string;
  neg: boolean;
  exact: boolean;
  prefix: boolean;
  suffix: boolean;
  /** Smart case: a capital anywhere in the term makes it case-sensitive. */
  caseSensitive: boolean;
}

export type RegexReason = 'literal' | 'prefix' | 'auto';

/** A `cat:<name>` filter peeled off the query; `''`/`general` means uncategorised. */
interface Scoped {
  category?: string;
}

export type Plan =
  | ({ mode: 'empty'; ok: true } & Scoped)
  | ({ mode: 'fuzzy'; ok: true; terms: Term[] } & Scoped)
  | ({ mode: 'regex'; ok: true; re: RegExp; reason: RegexReason } & Scoped)
  | ({ mode: 'regex'; ok: false; reason: RegexReason; error: string } & Scoped);

/**
 * Splits `cat:health` / `cat:"two words"` tokens (case-insensitive) out of a
 * query; the last one wins. Returns the query without them.
 */
export function peelCategory(raw: string): { rest: string; category?: string } {
  let category: string | undefined;
  const rest = raw
    .replace(/(^|\s)cat:(?:"([^"]*)"|(\S*))/gi, (_m, lead: string, quoted?: string, bare?: string) => {
      category = (quoted ?? bare ?? '').trim();
      return lead;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return category === undefined ? { rest } : { rest, category };
}

export interface TermMatch {
  score: number;
  /** Matched character indices in the text (ascending). */
  positions: number[];
}

export interface MatchResult {
  score: number;
  /** One entry per input field, each the matched indices in that field (may be unsorted). */
  positions: number[][];
}

export interface Part {
  text: string;
  hit: boolean;
}

function charClass(ch: string): number {
  if (ch === ' ' || ch === '\t' || ch === '\n') return C_WHITE;
  if ('/:;,|'.includes(ch)) return C_DELIM;
  if (ch >= 'a' && ch <= 'z') return C_LOWER;
  if (ch >= 'A' && ch <= 'Z') return C_UPPER;
  if (ch >= '0' && ch <= '9') return C_NUMBER;
  if (/\p{L}/u.test(ch)) return ch === ch.toUpperCase() ? C_UPPER : C_LOWER;
  return C_NONWORD;
}

function bonusFor(prev: number, cur: number): number {
  if (cur >= C_LOWER) {
    if (prev === C_WHITE) return BONUS_BOUNDARY_WHITE;
    if (prev === C_DELIM) return BONUS_BOUNDARY_DELIM;
    if (prev === C_NONWORD) return BONUS_BOUNDARY;
    if (prev === C_LOWER && cur === C_UPPER) return BONUS_CAMEL;
    if (prev === C_NUMBER && cur !== C_NUMBER) return BONUS_CAMEL;
    return 0;
  }
  if (cur === C_NONWORD || cur === C_DELIM) return BONUS_NON_WORD;
  return 0;
}

/** fzf v2: optimal alignment of `pattern` inside `text`. */
export function fuzzyMatch(pattern: string, text: string, caseSensitive = false): TermMatch | null {
  const m = pattern.length;
  const n = text.length;
  if (!m) return { score: 0, positions: [] };
  if (m > n) return null;
  const T = caseSensitive ? text : text.toLowerCase();
  const P = caseSensitive ? pattern : pattern.toLowerCase();
  // Cheap forward scan first — most items fail here.
  let k = 0;
  for (let i = 0; i < n && k < m; i++) if (T[i] === P[k]) k++;
  if (k < m) return null;

  const bonus = new Int16Array(n);
  let prev = C_WHITE;
  for (let i = 0; i < n; i++) {
    const c = charClass(text[i]);
    bonus[i] = bonusFor(prev, c);
    prev = c;
  }

  // M[i][j]: best score with pattern[i] matched at text[j].
  // G[i][j]: best M[i][k] (k<=j) carrying a gap that has been open through j; Gk remembers k.
  const M: Float64Array[] = [];
  const G: Float64Array[] = [];
  const Gk: Int32Array[] = [];
  const From: Int8Array[] = [];
  for (let i = 0; i < m; i++) {
    M.push(new Float64Array(n).fill(NEG));
    G.push(new Float64Array(n).fill(NEG));
    Gk.push(new Int32Array(n).fill(-1));
    From.push(new Int8Array(n));
    for (let j = i; j < n; j++) {
      if (T[j] === P[i]) {
        if (i === 0) {
          M[0][j] = SCORE_MATCH + bonus[j] * BONUS_FIRST_MULT;
        } else {
          let best = NEG;
          let from = 0;
          const d = M[i - 1][j - 1];
          if (d > NEG) {
            best = d + SCORE_MATCH + Math.max(bonus[j], BONUS_CONSECUTIVE);
            from = 1;
          }
          const g = G[i - 1][j - 1];
          if (g > NEG && g + SCORE_MATCH + bonus[j] > best) {
            best = g + SCORE_MATCH + bonus[j];
            from = 2;
          }
          M[i][j] = best;
          From[i][j] = from;
        }
      }
      let g = NEG;
      let gk = -1;
      if (M[i][j] > NEG) {
        g = M[i][j] + SCORE_GAP_START;
        gk = j;
      }
      if (j > 0 && G[i][j - 1] > NEG && G[i][j - 1] + SCORE_GAP_EXT > g) {
        g = G[i][j - 1] + SCORE_GAP_EXT;
        gk = Gk[i][j - 1];
      }
      G[i][j] = g;
      Gk[i][j] = gk;
    }
  }
  let best = NEG;
  let bj = -1;
  for (let j = 0; j < n; j++) {
    if (M[m - 1][j] > best) {
      best = M[m - 1][j];
      bj = j;
    }
  }
  if (bj < 0) return null;
  const positions: number[] = new Array(m);
  for (let i = m - 1, j = bj; i >= 0; i--) {
    positions[i] = j;
    if (i === 0) break;
    j = From[i][j] === 1 ? j - 1 : Gk[i - 1][j - 1];
  }
  return { score: best, positions };
}

function regexFrom(pattern: string, flags: string, reason: RegexReason): Plan {
  let f = flags;
  if (!f.includes('i')) f += 'i';
  if (!f.includes('g')) f += 'g';
  try {
    return { mode: 'regex', ok: true, re: new RegExp(pattern, f), reason };
  } catch (e) {
    return { mode: 'regex', ok: false, reason, error: errorMessage(e) };
  }
}

/** Parse the raw query into a plan. `autoRegex` treats metacharacter-bearing queries that compile as regex. */
export function parseQuery(raw: string, opts: { autoRegex?: boolean } = {}): Plan {
  const { rest, category } = peelCategory(raw);
  const plan = parseTerms(rest, opts);
  return category === undefined ? plan : { ...plan, category };
}

function parseTerms(raw: string, opts: { autoRegex?: boolean }): Plan {
  const q = raw.trim();
  if (!q) return { mode: 'empty', ok: true };
  const lit = /^\/(.*)\/([a-z]*)$/i.exec(q);
  if (lit) return regexFrom(lit[1], lit[2], 'literal');
  if (q.startsWith('/')) return regexFrom(q.slice(1), '', 'prefix');
  if (opts.autoRegex && /[\\^$.*+?()[\]{}|]/.test(q)) {
    const r = regexFrom(q, '', 'auto');
    if (r.ok) return r;
  }
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t): Term => {
      const term: Term = { text: t, neg: false, exact: false, prefix: false, suffix: false, caseSensitive: false };
      if (term.text.startsWith('!')) {
        term.neg = true;
        term.text = term.text.slice(1);
      }
      if (term.text.startsWith("'")) {
        term.exact = true;
        term.text = term.text.slice(1);
      }
      if (term.text.startsWith('^')) {
        term.prefix = true;
        term.exact = true;
        term.text = term.text.slice(1);
      }
      if (term.text.endsWith('$') && term.text.length > 1) {
        term.suffix = true;
        term.exact = true;
        term.text = term.text.slice(0, -1);
      }
      term.caseSensitive = /[A-Z]/.test(term.text);
      return term;
    })
    .filter((t) => t.text);
  return terms.length ? { mode: 'fuzzy', ok: true, terms } : { mode: 'empty', ok: true };
}

function regexRanges(re: RegExp, s: string): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null = re.exec(s);
  while (m) {
    const start = m.index;
    const end = Math.min(start + Math.max(m[0].length, 1), s.length);
    out.push([start, end]);
    if (re.lastIndex <= start) re.lastIndex = start + 1;
    m = re.exec(s);
  }
  return out;
}

function matchTerm(term: Term, text: string): TermMatch | null {
  if (term.exact || term.neg) {
    const hay = term.caseSensitive ? text : text.toLowerCase();
    const needle = term.caseSensitive ? term.text : term.text.toLowerCase();
    let at = hay.indexOf(needle);
    if (at < 0) return null;
    if (term.prefix && at !== 0) return null;
    if (term.suffix) {
      at = hay.lastIndexOf(needle);
      if (at + needle.length !== hay.length) return null;
    }
    const positions: number[] = [];
    for (let i = at; i < at + needle.length; i++) positions.push(i);
    const boundary = at === 0 || charClass(text[at - 1]) < C_LOWER ? BONUS_BOUNDARY_WHITE : 0;
    return { score: SCORE_MATCH * needle.length + boundary * BONUS_FIRST_MULT, positions };
  }
  return fuzzyMatch(term.text, text, term.caseSensitive);
}

/**
 * Match one item. `fields` is ordered, title first — it carries full weight,
 * secondary fields 0.85×. Regex mode scores by match count.
 */
export function matchItem(plan: Plan, fields: string[]): MatchResult | null {
  if (plan.mode === 'empty' || !plan.ok) return null;
  const positions: number[][] = fields.map(() => []);
  let score = 0;
  if (plan.mode === 'regex') {
    let any = false;
    fields.forEach((f, fi) => {
      const ranges = regexRanges(plan.re, f);
      if (!ranges.length) return;
      any = true;
      score += ranges.length;
      for (const [s, e] of ranges) for (let k = s; k < e; k++) positions[fi].push(k);
    });
    return any ? { score, positions } : null;
  }
  for (const term of plan.terms) {
    let best: TermMatch | null = null;
    let bi = -1;
    fields.forEach((f, fi) => {
      const r = matchTerm(term, f);
      if (r && (!best || r.score > best.score)) {
        best = r;
        bi = fi;
      }
    });
    if (term.neg) {
      if (best) return null;
      continue;
    }
    if (!best) return null;
    const b: TermMatch = best;
    score += b.score * (bi === 0 ? 1 : 0.85);
    positions[bi].push(...b.positions);
  }
  return { score, positions };
}

/** Split `text` into runs for highlighting: `[{text, hit}]` with matched indices merged. */
export function toParts(text: string, positions: number[] | undefined): Part[] {
  if (!positions?.length) return [{ text, hit: false }];
  const set = new Set(positions);
  const parts: Part[] = [];
  let cur = '';
  let hit = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== hit) {
      if (cur) parts.push({ text: cur, hit });
      cur = '';
      hit = h;
    }
    cur += text[i];
  }
  if (cur) parts.push({ text: cur, hit });
  return parts;
}
