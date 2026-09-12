#!/usr/bin/env node
/**
 * CSS hygiene audit for the app (`src/`). Exits 1 on any finding, so it can
 * gate CI. No dependencies.
 *
 *   node scripts/css-audit.mjs            # all checks
 *   node scripts/css-audit.mjs --classes  # (a) only
 *   node scripts/css-audit.mjs --tokens   # (c) only
 *
 * (a) Component classes and `@utility` names declared in `src/App.css` that no
 *     TSX/TS/HTML file references (dead), plus a report of classes used by a
 *     single file (not a failure — page-layout classes are expected to be).
 * (b) Theme-keyed utilities in TSX (`bg-*`, `text-*`, `border-*`, `shadow-*`,
 *     `font-*`, `ring-*`, `fill-*`, `stroke-*`, `outline-*`, `accent-*`,
 *     `decoration-*`, `divide-*`, `from-*`/`to-*`/`via-*`) whose suffix is not
 *     a key in `@theme`, a built-in keyword, an arbitrary value, or a numeric
 *     size — Tailwind v4 silently emits nothing for these (`bg-tertiary-container`
 *     made the current-time line invisible). Tailwind palette colours
 *     (`text-amber-400`) are flagged too: the design is tokens only.
 * (c) `src/colors.ts` CATEGORY_ACCENTS must equal the `--t-cat-*` values on
 *     `:root`, and no `#hex` literal may appear in `src/**` TSX/TS outside the
 *     allowlist below.
 * (e) Every inline `style={` in TSX carries a `dynamic:` comment within the
 *     three lines above it — inline styles are for runtime values only
 *     (a stored colour, computed geometry); anything static is a utility.
 * (d) Phone layout is `max-md:` only: `src/App.css` must contain no
 *     `@media (max-width …)` block, and `useMedia.ts`'s MOBILE_QUERY must be
 *     the 768px that Tailwind's `md` (48rem) breakpoint means.
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
];

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
    const re = new RegExp(`(?<![\\w-])${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`);
    const users = sources.filter((s) => re.test(s.text)).map((s) => s.path);
    if (users.length === 0) dead.push(name);
    else if (users.length === 1) single.push(`${name} → ${users[0]}`);
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
    'white',
    'black',
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
    if (ns === 'shadow' && (shadowNames.has(name) || /^(inner|none|2xs|xs|sm|md|lg|xl|2xl)$/.test(name))) return true;
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
    // Class strings live inside quotes on one line; scan per line so an
    // apostrophe in a comment elsewhere can't swallow half the file.
    s.text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
      for (const q of line.matchAll(/(['"`])([^'"`]*)\1/g)) {
        for (const tok of q[2].split(/\s+/)) {
          const base = tok.split(':').pop(); // strip variants (hover:, md:, …)
          const bare = base.replace(/^!/, '').replace(/\/(\d+|\[.*\])$/, ''); // opacity modifier
          const m = bare.match(
            /^(bg|text|border|shadow|font|ring|fill|stroke|outline|accent|decoration|divide|caret|placeholder)-([a-z0-9][\w\-[\]().%,#/]*)$/i,
          );
          if (!m) continue;
          const [, ns, name] = m;
          if (PALETTE.test(name)) {
            seen.set(`${tok} (Tailwind palette, not a token)`, `${s.path}:${i + 1}`);
            continue;
          }
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
      if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(line) && !/#\{/.test(line))
        hexHits.push(`${s.path}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  if (hexHits.length) {
    fail('hex literals outside the allowlist:');
    hexHits.forEach(note);
  } else console.log('✓ no hex literals outside colors.ts');
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
