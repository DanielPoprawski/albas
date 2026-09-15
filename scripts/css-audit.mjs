#!/usr/bin/env node
/**
 * CSS hygiene audit for the app (`src/`). Exits 1 on any finding, so it can
 * gate CI. No dependencies.
 *
 *   node scripts/css-audit.mjs               # all checks
 *   node scripts/css-audit.mjs --classes     # (a) only; likewise --utilities
 *                                            # (b), --tokens (c), --breakpoint
 *                                            # (d), --inline (e), --px (f),
 *                                            # --icons (g), --theme (h)
 *
 * (a) Component classes and `@utility` names declared in `src/App.css` that no
 *     TSX/TS/HTML file references from a class string or `@apply` (dead), plus
 *     a report of classes used by a single file (not a failure — page-layout
 *     classes are expected to be).
 * (b) Theme-keyed utilities in TSX (`bg-*`, `text-*`, `border-*`, `shadow-*`,
 *     `font-*`, `ring-*`, `fill-*`, `stroke-*`, `outline-*`, `accent-*`,
 *     `decoration-*`, `divide-*`, `from-*`/`to-*`/`via-*`) whose suffix is not
 *     a key in `@theme`, a built-in keyword, an arbitrary value, or a numeric
 *     size — Tailwind v4 silently emits nothing for these (`bg-tertiary-container`
 *     made the current-time line invisible). Tailwind palette colours
 *     (`text-amber-400`), `white`/`black`, stock shadows (`shadow-2xl`) and
 *     raw tokens (`text-[var(--t-ink)]`, which bypass `@theme` and
 *     tailwind-merge) are flagged too: the design is tokens only.
 * (c) `src/colors.ts` CATEGORY_ACCENTS must equal the `--t-cat-*` values on
 *     `:root`, and no `#hex` / `rgb()` / `hsl()` literal may appear in `src/**`
 *     TSX/TS outside the allowlist below.
 * (d) Phone layout is `max-md:` only: `src/App.css` must contain no
 *     `@media (max-width …)` block, `useMedia.ts`'s MOBILE_QUERY must be the
 *     768px that Tailwind's `md` (48rem) breakpoint means, and no TSX may use
 *     the desktop-first `md:` variant (the phone is the exception, not the
 *     default).
 * (e) Every inline `style={` in TSX carries a `dynamic:` comment within the
 *     three lines above it — inline styles are for runtime values only
 *     (a stored colour, computed geometry); anything static is a utility.
 * (f) No `px` in a TSX class (`w-[9px]`, `tracking-[0.5px]`) beyond the 1–2px
 *     a hairline needs: Settings › Text size scales the `html` font, so
 *     geometry is rem.
 * (g) Every lucide icon passes `size="…rem"` — the default is 24px and a
 *     bare number is px, neither of which scales.
 * (h) Every `@theme` key and every `@keyframes` name is referenced somewhere
 *     (a utility in TSX, `@apply`/`var()` in App.css, or an `animate-[…]`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CSS = join(ROOT, 'src/App.css');
const args = new Set(process.argv.slice(2));
const only = (flag) => args.size === 0 || args.has(flag);

const HEX_ALLOWLIST = [
  'src/colors.ts', // the TS mirror of :root (asserted by (c))
  'src/components/forms/shared.tsx', // the colour wheel's conic-gradient
  'src/appearance.ts', // pre-CSS surface fallback in applyAppearance
  'src/components/Logo.tsx', // brand art: the gradient stops and the white glyph are the logo, not UI
  'src/ics.ts', // exports the stored hex
  // The camera overlay sits on a live video feed, not on a themed surface:
  // white and a black scrim are the only colours that read on it.
  'src/components/auth/QrScanner.tsx',
];

/** Files whose `white`/`black` utilities are deliberate (see HEX_ALLOWLIST). */
const LITERAL_COLOR_ALLOWLIST = ['src/components/auth/QrScanner.tsx'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(name)) out.push(p);
  }
  return out;
}

const css = readFileSync(CSS, 'utf8');
const files = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')].filter((f) => !f.endsWith('.d.ts'));
const sources = files.map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

/** A source's text with `//` lines, block comments and JSX comments blanked, so prose never counts as usage. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line.replace(/\s\/\/.*$/, '')))
    .join('\n');
}
const code = sources.map((s) => ({ path: s.path, text: codeOnly(s.text) }));
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`✗ ${msg}`);
};
const note = (msg) => console.log(`  ${msg}`);

/* ── theme keys ─────────────────────────────────────────────────────────── */
const themeBlocks = [...css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
const themeKeys = new Set([...themeBlocks.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
const themeNames = (ns) =>
  new Set([...themeKeys].filter((k) => k.startsWith(`${ns}-`) && !k.includes('--')).map((k) => k.slice(ns.length + 1)));
const colorNames = themeNames('color');
const fontNames = themeNames('font');
const shadowNames = themeNames('shadow');
const textNames = themeNames('text');
const spacingNames = themeNames('spacing');

/* ── (a) declared classes vs usage ──────────────────────────────────────── */
if (only('--classes')) {
  const declared = new Map(); // name -> kind
  for (const m of css.matchAll(/@utility\s+([a-z][a-z0-9-]*)/g)) declared.set(m[1], 'utility');
  // Plain selectors outside @theme / @utility / @keyframes bodies.
  const stripped = css
    .replace(/@theme[^{]*\{[\s\S]*?\n\}/g, '')
    .replace(/@utility[^{]*\{[\s\S]*?\n\}/g, '')
    .replace(/@keyframes[^{]*\{[\s\S]*?\n\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/\.([a-z][a-z0-9-]*)(?=[\s,.:{[>#)])/g)) {
    if (!declared.has(m[1])) declared.set(m[1], 'class');
  }
  const runtimeInjected = new Set(['lucide']); // lucide-react stamps class="lucide"
  const dead = [];
  const single = [];
  for (const [name] of declared) {
    if (runtimeInjected.has(name)) continue;
    // Only a class-string position counts: inside quotes, between other
    // classes, or after `@apply` — never the same word in a comment.
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`(?<=['"\`\\s])${escaped}(?=[\\s'"\`$])`);
    const users = code.filter((s) => re.test(s.text)).map((s) => s.path);
    const applied = new RegExp(`@apply[^;]*(?<![\\w-])${escaped}(?![\\w-])`).test(cssCode);
    if (users.length === 0 && !applied) dead.push(name);
    else if (users.length === 1 && !applied) single.push(`${name} → ${users[0]}`);
  }
  if (dead.length) fail(`dead classes in src/App.css: ${dead.join(', ')}`);
  else console.log(`✓ no dead classes (${declared.size} declared)`);
  if (single.length) {
    console.log(`  ${single.length} single-file classes (informational):`);
    for (const s of single) note(s);
  }
}

/* ── (b) unknown theme utilities in TSX ─────────────────────────────────── */
if (only('--utilities')) {
  const PALETTE =
    /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/;
  const KEYWORDS = new Set([
    'transparent',
    'current',
    'inherit',
    'none',
    'auto',
    'solid',
    'dashed',
    'dotted',
    'double',
    'wavy',
    'clip',
    'ellipsis',
    'wrap',
    'nowrap',
    'balance',
    'pretty',
    'left',
    'right',
    'center',
    'justify',
    'start',
    'end',
    'top',
    'bottom',
    'cover',
    'contain',
    'fixed',
    'local',
    'scroll',
    'repeat',
    'no-repeat',
    'clone',
    'slice',
    'inset',
    'hidden',
    'thin',
    'medium',
    'thick',
    'sans',
    'serif',
    'mono',
    'normal',
    'italic',
    'ordinal',
    'nums',
    'xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
    '6xl',
    '7xl',
    '8xl',
    '9xl',
    'offset',
    'x',
    'y',
    'linear',
    'radial',
    'conic',
    'collapse',
    'separate',
    'spacing',
    'size',
    'position',
    'origin',
  ]);
  const known = (ns, name) => {
    if (KEYWORDS.has(name) || /^\[.*\]$/.test(name) || /^\(.*\)$/.test(name)) return true;
    if (/^\d+(\.\d+)?$/.test(name) || /^\d+\/\d+$/.test(name)) return true; // sizes, fractions
    if (colorNames.has(name)) return true;
    if (
      ns === 'font' &&
      (fontNames.has(name) ||
        /^(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|stretch-.*)$/.test(name))
    )
      return true;
    // Stock shadows carry a literal black; the design's are `--t-shadow-*`.
    if (ns === 'shadow' && (shadowNames.has(name) || name === 'none')) return true;
    if (
      ns === 'text' &&
      (textNames.has(name) ||
        /^(left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|xs|sm|base|lg|xl|\dxl)$/.test(
          name,
        ))
    )
      return true;
    if (
      (ns === 'border' || ns === 'divide' || ns === 'outline' || ns === 'ring') &&
      /^(\d+|[xytrbls]|[xytrbls]-\d+|solid|dashed|dotted|double|none|hidden|collapse|separate|inset|offset-\d+)$/.test(
        name,
      )
    )
      return true;
    if (
      ns === 'bg' &&
      /^(cover|contain|auto|fixed|local|scroll|clip-.*|origin-.*|repeat.*|no-repeat|(top|bottom|left|right|center)(-.*)?|gradient-to-.*|linear-.*|radial.*|conic.*|none)$/.test(
        name,
      )
    )
      return true;
    if (ns === 'stroke' && /^\d+$/.test(name)) return true;
    if ((ns === 'decoration' || ns === 'outline' || ns === 'ring') && /^\d+$/.test(name)) return true;
    if (spacingNames.has(name)) return true;
    if ((ns === 'ring' || ns === 'outline') && name.startsWith('offset-')) return known(ns, name.slice(7));
    return false;
  };
  const seen = new Map();
  for (const s of sources) {
    if (!s.path.endsWith('.tsx')) continue;
    const literalsOk = LITERAL_COLOR_ALLOWLIST.includes(s.path);
    // Class strings live inside quotes on one line; scan per line so an
    // apostrophe in a comment elsewhere can't swallow half the file.
    s.text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
      for (const q of line.matchAll(/(['"`])([^'"`]*)\1/g)) {
        for (const tok of q[2].split(/\s+/)) {
          const base = tok.split(':').pop(); // strip variants (hover:, md:, …)
          const bare = base.replace(/^!/, '').replace(/\/(\d+|\[.*\])$/, ''); // opacity modifier
          const m = bare.match(
            /^(bg|text|border|shadow|font|ring|fill|stroke|outline|accent|decoration|divide|caret|placeholder|from|via|to)-([a-z0-9[][\w\-[\]().%,#/]*)$/,
          );
          if (!m) continue;
          const [, ns, name] = m;
          if (/^\[var\(--t-/.test(name)) {
            seen.set(`${tok} (raw token — use the @theme class)`, `${s.path}:${i + 1}`);
            continue;
          }
          // Gradient stops share their prefixes with English ("to-do"); only
          // the raw-token form above is checked for them.
          if (ns === 'from' || ns === 'via' || ns === 'to') continue;
          if (PALETTE.test(name)) {
            seen.set(`${tok} (Tailwind palette, not a token)`, `${s.path}:${i + 1}`);
            continue;
          }
          if ((name === 'white' || name === 'black') && !literalsOk) {
            seen.set(`${tok} (literal colour — use a token)`, `${s.path}:${i + 1}`);
            continue;
          }
          if (name === 'white' || name === 'black') continue;
          if (!known(ns, name)) seen.set(`${tok} (no @theme key for ${ns}-${name})`, `${s.path}:${i + 1}`);
        }
      }
    });
  }
  if (seen.size) {
    fail(`unknown theme utilities (compile to nothing):`);
    for (const [tok, path] of seen) note(`${tok} — ${path}`);
  } else console.log('✓ every theme-keyed utility resolves');
}

/* ── (c) colour source of truth ─────────────────────────────────────────── */
if (only('--tokens')) {
  const rootBlock = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
  const rootVars = Object.fromEntries(
    [...rootBlock.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
  );
  const colors = readFileSync(join(ROOT, 'src/colors.ts'), 'utf8');
  const accents = colors.match(/CATEGORY_ACCENTS = \{([\s\S]*?)\n\}/)?.[1] ?? '';
  let mismatches = 0;
  for (const m of accents.matchAll(
    /^\s*(\w+):\s*\{\s*hex:\s*'(#[0-9a-f]{6})',\s*tint:\s*'(#[0-9a-f]{6})',\s*line:\s*'(#[0-9a-f]{6})',\s*ink:\s*'(#[0-9a-f]{6})'/gm,
  )) {
    const [, name, hex, tint, line, ink] = m;
    const want = {
      [`t-cat-${name}`]: hex,
      [`t-cat-${name}-tint`]: tint,
      [`t-cat-${name}-line`]: line,
      [`t-cat-${name}-ink`]: ink,
    };
    for (const [k, v] of Object.entries(want)) {
      if ((rootVars[k] ?? '').toLowerCase() !== v.toLowerCase()) {
        mismatches++;
        fail(`colors.ts ${name} vs :root --${k}: ${v} ≠ ${rootVars[k] ?? '(missing)'}`);
      }
    }
  }
  if (!mismatches) console.log('✓ colors.ts CATEGORY_ACCENTS matches :root --t-cat-*');

  const hexHits = [];
  for (const s of sources) {
    if (HEX_ALLOWLIST.includes(s.path) || s.path.endsWith('.html')) continue;
    s.text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
      const hex = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(line) && !/#\{/.test(line);
      const fn = /\b(rgba?|hsla?)\(/.test(line);
      if (hex || fn) hexHits.push(`${s.path}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  if (hexHits.length) {
    fail('colour literals (hex / rgb() / hsl()) outside the allowlist:');
    hexHits.forEach(note);
  } else console.log('✓ no colour literals outside colors.ts');
}

/* ── (d) one breakpoint, expressed as `max-md:` ─────────────────────── */
if (only('--breakpoint')) {
  const media = [...css.matchAll(/@media\s*\(max-width[^)]*\)/g)].map((m) => m[0]);
  if (media.length) fail(`phone layout must be max-md: utilities, not App.css media queries: ${media.join(', ')}`);
  else console.log('✓ no max-width media queries in App.css');
  const useMedia = readFileSync(join(ROOT, 'src/useMedia.ts'), 'utf8');
  if (!/MOBILE_QUERY = '\(max-width: 768px\)'/.test(useMedia))
    fail("useMedia.ts MOBILE_QUERY must stay '(max-width: 768px)' (= Tailwind md, 48rem)");
  else console.log('✓ MOBILE_QUERY matches the md breakpoint');
  const desktopFirst = [];
  for (const s of code) {
    if (!s.path.endsWith('.tsx')) continue;
    s.text.split('\n').forEach((line, i) => {
      // A variant is glued to its utility (`md:flex`); an object key is not (`md: '…'`).
      if (/(?<![\w-])md:[a-z[!-]/.test(line)) desktopFirst.push(`${s.path}:${i + 1}`);
    });
  }
  if (desktopFirst.length) {
    fail('desktop-first `md:` variant (phone layout is `max-md:`; the desktop is the default):');
    desktopFirst.forEach(note);
  } else console.log('✓ no desktop-first md: variants');
}

/* ── (f) rem, not px ─────────────────────────────────────────────────── */
if (only('--px')) {
  const px = [];
  for (const s of code) {
    if (!s.path.endsWith('.tsx')) continue;
    s.text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\[(-?\d+(?:\.\d+)?)px\]/g)) {
        if (Math.abs(Number(m[1])) > 2) px.push(`${s.path}:${i + 1}: ${m[0]}`);
      }
    });
  }
  if (px.length) {
    fail('px in a class beyond a 1–2px hairline (Settings › Text size scales rem, not px):');
    px.forEach(note);
  } else console.log('✓ no px geometry in classes');
}

/* ── (g) lucide icons are sized in rem ──────────────────────────────── */
if (only('--icons')) {
  const bad = [];
  for (const s of code) {
    if (!s.path.endsWith('.tsx')) continue;
    const imported = s.text.match(/import \{([^}]*)\} from 'lucide-react'/);
    if (!imported) continue;
    const names = imported[1]
      .split(',')
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      )
      .filter(Boolean);
    for (const name of names) {
      for (const m of s.text.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))) {
        const attrs = m[1];
        const line = s.text.slice(0, m.index).split('\n').length;
        if (!/\bsize=/.test(attrs)) bad.push(`${s.path}:${line}: <${name}> has no size (defaults to 24px)`);
        else if (/\bsize=\{\s*\d/.test(attrs)) bad.push(`${s.path}:${line}: <${name}> sized in px`);
      }
    }
  }
  if (bad.length) {
    fail('lucide icons must pass size="…rem":');
    bad.forEach(note);
  } else console.log('✓ every lucide icon is sized in rem');
}

/* ── (h) nothing declared in @theme or @keyframes goes unused ─────────── */
if (only('--theme')) {
  const allCode = code.map((s) => s.text).join('\n');
  const unused = [];
  for (const key of themeKeys) {
    if (key.includes('--')) continue; // `--text-h1--line-height` rides on `--text-h1`
    const [ns, ...rest] = key.split('-');
    const name = rest.join('-');
    if (!name) continue;
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    // A utility (`bg-accent`, `px-sm`, `max-wide:`), an `@apply`, or a `var()`.
    const used =
      new RegExp(`(?<![\\w-])[a-z-]+-${escaped}(?![\\w-])`).test(allCode) ||
      new RegExp(`(?<![\\w-])[a-z-]+-${escaped}(?![\\w-])`).test(cssCode) ||
      (ns === 'breakpoint' && new RegExp(`(?<![\\w-])(max-)?${escaped}:`).test(allCode)) ||
      new RegExp(`var\\(--${key}\\)`).test(allCode + cssCode);
    if (!used) unused.push(`--${key}`);
  }
  for (const m of cssCode.matchAll(/@keyframes\s+([a-z][\w-]*)/g)) {
    if (!new RegExp(`animate-\\[${m[1]}[_\\]]`).test(allCode + cssCode)) unused.push(`@keyframes ${m[1]}`);
  }
  if (unused.length) fail(`declared but unused in src/App.css: ${unused.join(', ')}`);
  else console.log(`✓ every @theme key and keyframe is used (${themeKeys.size} keys)`);
}

/* ── (e) inline styles are runtime-only, and say so ─────────────────── */
if (only('--inline')) {
  const bare = [];
  for (const s of sources) {
    if (!s.path.endsWith('.tsx')) continue;
    const lines = s.text.split('\n');
    lines.forEach((line, i) => {
      if (!/\bstyle=\{/.test(line)) return;
      if (!lines.slice(Math.max(0, i - 3), i + 1).some((l) => /dynamic:/.test(l))) bare.push(`${s.path}:${i + 1}`);
    });
  }
  if (bare.length) {
    fail('inline style without a `// dynamic:` comment (static styling belongs in utilities):');
    bare.forEach(note);
  } else console.log('✓ every inline style is annotated as dynamic');
}

process.exit(failures ? 1 : 0);
