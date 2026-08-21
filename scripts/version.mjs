#!/usr/bin/env node
/**
 * One version number, five files.
 *
 * `package.json` is the source of truth; everything else is derived. Run
 * `bun run version:set 1.9.0` to move them all, or `bun run version:check`
 * to fail if they have drifted apart.
 *
 * Not covered on purpose:
 *  - `sync-server/` is versioned independently. It is a separately deployed
 *    artifact whose protocol is backward-compatible by design, so a server
 *    rebuild does not imply an app release.
 *  - `tauri.android.versionCode` is monotonic, not derived, so it is bumped
 *    rather than set — and `--check` ignores it. Android identifies an upgrade
 *    by this integer, so it must never go backwards.
 *
 * Edits are regex-based rather than parse-and-reserialise so the files keep
 * their existing formatting (tauri.conf.json is indented with six spaces, and
 * rewriting it with JSON.stringify would reflow the whole file).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The first `"version": "…"` in each JSON file is the package's own. */
const targets = [
  { file: 'package.json', re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: 'src-tauri/tauri.conf.json', re: /("version"\s*:\s*")([^"]+)(")/ },
  // Anchored to the line start so it can't match a dependency's
  // `{ version = "2" }`, which is not at column 0.
  { file: 'src-tauri/Cargo.toml', re: /(^version\s*=\s*")([^"]+)(")/m },
  // Keyed off the package name so it hits the albas entry, not a dependency's.
  { file: 'src-tauri/Cargo.lock', re: /(^name = "albas"\nversion = ")([^"]+)(")/m },
  { file: 'src-tauri/gen/android/app/tauri.properties', re: /(tauri\.android\.versionName=)([^\n]+)()/ },
];

const CODE_RE = /(tauri\.android\.versionCode=)(\d+)/;
const PROPS = 'src-tauri/gen/android/app/tauri.properties';

const read = (f) => readFileSync(join(root, f), 'utf8');

function current(t) {
  const m = t.re.exec(read(t.file));
  if (!m) throw new Error(`no version found in ${t.file} — the format changed, fix ${'version.mjs'}`);
  return m[2];
}

const arg = process.argv[2];

if (arg === '--check') {
  const want = current(targets[0]);
  const bad = targets.slice(1).filter((t) => current(t) !== want);
  for (const t of bad) console.error(`  ${t.file}: ${current(t)} (expected ${want})`);
  if (bad.length) {
    console.error(`\nversion drift: package.json says ${want}. Run: bun run version:set ${want}`);
    process.exit(1);
  }
  console.log(`all version files agree on ${want}`);
  process.exit(0);
}

if (!arg || !/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error('usage: node scripts/version.mjs <major.minor.patch> | --check');
  process.exit(2);
}

for (const t of targets) {
  const before = read(t.file);
  const after = before.replace(t.re, (_, a, _old, c) => `${a}${arg}${c}`);
  if (before === after && current(t) !== arg) throw new Error(`failed to rewrite ${t.file}`);
  writeFileSync(join(root, t.file), after);
  console.log(`  ${t.file} -> ${arg}`);
}

// versionCode is bumped, never set: Android refuses an install whose code is
// not greater than the installed one.
const props = read(PROPS);
const code = Number(CODE_RE.exec(props)[2]) + 1;
writeFileSync(join(root, PROPS), props.replace(CODE_RE, (_, k) => `${k}${code}`));
console.log(`  ${PROPS} -> versionCode ${code}`);

console.log(`\nnow tag it:  git tag v${arg}`);
