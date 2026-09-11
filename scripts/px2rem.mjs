#!/usr/bin/env node
// One-off px -> rem pass over src/App.css and src/**/*.tsx (16px base).
// Keeps: @media breakpoints, values under 3px (hairlines/outlines/letter-spacing),
// and files whose px are runtime pixel math. Idempotent: a converted file has no
// matching px left. Run: node scripts/px2rem.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 16;
const MIN_PX = 3;
const SKIP_FILES = new Set(['src/useMedia.ts']);
const dry = process.argv.includes('--dry');

function rem(px) {
  const r = px / BASE;
  return `${parseFloat(r.toFixed(4))}rem`;
}

function convertLine(line, { css }) {
  if (css && /^\s*@media/.test(line)) return line;
  if (/\(max-width:\s*\d+px\)|\(min-width:\s*\d+px\)/.test(line)) return line;
  // Negative Tailwind arbitrary values (`-mt-[5px]`) and plain ones share the
  // `[Npx]` shape; plain CSS / inline-style values are `Npx` after a space,
  // colon, quote, underscore (shadow-[0_4px_...]) or paren.
  return line.replace(/(-?)(\d*\.?\d+)px\b/g, (m, sign, num) => {
    const px = parseFloat(num);
    if (!Number.isFinite(px) || px < MIN_PX) return m;
    return `${sign}${rem(px)}`;
  });
}

function convertFile(path, css) {
  const before = readFileSync(path, 'utf8');
  const after = before
    .split('\n')
    .map((l) => convertLine(l, { css }))
    .join('\n');
  if (after !== before) {
    const n = (before.match(/\d*\.?\d+px\b/g) || []).length - (after.match(/\d*\.?\d+px\b/g) || []).length;
    console.log(`${path}: ${n} values`);
    if (!dry) writeFileSync(path, after);
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

convertFile('src/App.css', true);
for (const f of walk('src')) {
  if (SKIP_FILES.has(f)) continue;
  convertFile(f, false);
}
