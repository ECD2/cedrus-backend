/**
 * Source discipline.
 *
 * "Strict TypeScript, no any" is a requirement of this package, and `tsc` alone
 * does not enforce it: an explicit `any` compiles cleanly under every strict
 * flag there is. So it is asserted here, mechanically, over the actual source.
 *
 * Also asserted: no network, no filesystem, no environment access anywhere in
 * `src/`. This package is shapes and rules. A contract library that can reach a
 * database is a service, and it would drag every consumer's test suite onto the
 * network with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const walkFiles = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

const srcFiles = walkFiles(join(root, 'src'));

/** Strips block and line comments so a rule named in prose is not a violation. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * Strips string and template literals as well. The target is the TypeScript type
 * `any`, not the English word: "at any depth" inside a fixture description is
 * not a type escape, and a check that cannot tell them apart is a check that
 * gets deleted the first time it cries wolf.
 */
const stripLiterals = (source: string): string =>
  source
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

test('src/ contains no `any`', () => {
  const offenders: string[] = [];
  for (const file of srcFiles) {
    const code = stripLiterals(stripComments(readFileSync(file, 'utf8')));
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (/(^|[^A-Za-z0-9_$])any([^A-Za-z0-9_$]|$)/.test(line)) {
        offenders.push(`${file.replace(root, '.')}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `\`any\` found:\n${offenders.join('\n')}`);
});

test('src/ reaches no network, filesystem, environment or clock-dependent global', () => {
  const banned: readonly [RegExp, string][] = [
    [/\bfetch\s*\(/, 'network access'],
    [/\bXMLHttpRequest\b/, 'network access'],
    [/from\s+'node:(fs|http|https|net|dns|child_process)'/, 'node system module'],
    [/\bprocess\.env\b/, 'environment access'],
    [/\brequire\s*\(/, 'dynamic require'],
  ];
  const offenders: string[] = [];
  for (const file of srcFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [pattern, what] of banned) {
      if (pattern.test(code)) offenders.push(`${file.replace(root, '.')}: ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `forbidden capability in src/:\n${offenders.join('\n')}`);
});

test('src/ has no TODO or FIXME left behind', () => {
  const offenders: string[] = [];
  for (const file of srcFiles) {
    const source = readFileSync(file, 'utf8');
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(source)) offenders.push(file.replace(root, '.'));
  }
  assert.deepEqual(offenders, [], `unfinished markers left in src/:\n${offenders.join('\n')}`);
});

test('no real contact details are used in the fixtures', () => {
  /**
   * Every fixture is synthetic. Phone numbers use the 555 reserved block and
   * email addresses use the reserved `.invalid` TLD, so a fixture that escapes
   * into a test environment cannot reach a person.
   */
  // Vendored-copy path. The lab keeps its fixtures at `src/examples/`; this copy
  // moves them under `test/` so no synthetic record sits in the runtime path
  // that cedrus-backend imports. See VENDORED_FROM.md.
  const fixtures = readFileSync(join(here, 'examples', 'valid.ts'), 'utf8');
  const phones = fixtures.match(/1\d{10}/g) ?? [];
  for (const phone of phones) {
    assert.match(phone, /^1\d{3}555\d{4}$/, `${phone} is not in the reserved 555 range`);
  }
  const emails = fixtures.match(/[a-z0-9._-]+@[a-z0-9.-]+/gi) ?? [];
  for (const email of emails) {
    assert.match(email, /\.invalid$/, `${email} is not a reserved test address`);
  }
});
