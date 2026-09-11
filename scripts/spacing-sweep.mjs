#!/usr/bin/env node
// One-off pass over src/**/*.tsx that rewrites the redesign's arbitrary
// `[var(--space-N)]` Tailwind values to the equivalent named numeric spacing
// utility, now that the app's --space-4..24 scale (App.css) is a 1:1 alias of
// Tailwind's own default scale (each step is 0.25rem). Modelled on
// scripts/px2rem.mjs. Idempotent: a converted file has no matching pattern
// left. Run: node scripts/spacing-sweep.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// --space-N (rem value) -> Tailwind numeric spacing step (N * 0.25rem = the
// same rem value), per the mapping in the plan.
const SCALE = { 4: '1', 6: '1.5', 8: '2', 10: '2.5', 12: '3', 14: '3.5', 16: '4', 18: '4.5', 20: '5', 24: '6' };

const dry = process.argv.includes('--dry');
const PATTERN = /([a-zA-Z][a-zA-Z0-9-]*)-\[var\(--space-(\d+)\)\]/g;

function convertLine(line) {
  return line.replace(PATTERN, (m, prefix, n) => {
    const step = SCALE[n];
    if (step === undefined) return m; // unknown step — leave for manual review
    return `${prefix}-${step}`;
  });
}

function convertFile(path) {
  const before = readFileSync(path, 'utf8');
  const after = before.split('\n').map(convertLine).join('\n');
  if (after !== before) {
    const n = (before.match(PATTERN) || []).length;
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

for (const f of walk('src')) {
  convertFile(f);
}
