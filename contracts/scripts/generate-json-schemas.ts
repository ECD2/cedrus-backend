/**
 * Writes one JSON Schema file per contract into `schemas/`.
 *
 * The schemas are generated, not hand-written, so they cannot drift from the
 * validators. `test/json-schema-agreement.test.ts` fails if the files on disk
 * differ from what this script would write, which means a schema change and a
 * validator change always land in the same commit.
 *
 * Run: `npm run schemas`
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACTS } from '../src/registry.ts';
import { schemaFileName } from '../src/schema/core.ts';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', 'schemas');

export const renderSchema = (index: number): { readonly file: string; readonly body: string } => {
  const contract = CONTRACTS[index];
  if (contract === undefined) throw new Error(`no contract at index ${index}`);
  return {
    file: schemaFileName(contract),
    body: `${JSON.stringify(contract.jsonSchema, null, 2)}\n`,
  };
};

export const renderAll = (): readonly { readonly file: string; readonly body: string }[] =>
  CONTRACTS.map((_, i) => renderSchema(i));

const main = (): void => {
  mkdirSync(schemaDir, { recursive: true });

  const rendered = renderAll();
  const expected = new Set(rendered.map((r) => r.file));

  // Remove schemas for contracts that no longer exist, so the directory is a
  // faithful projection of the registry rather than an accumulation.
  for (const existing of readdirSync(schemaDir)) {
    if (existing.endsWith('.schema.json') && !expected.has(existing)) {
      rmSync(join(schemaDir, existing));
      process.stdout.write(`removed stale ${existing}\n`);
    }
  }

  for (const { file, body } of rendered) {
    writeFileSync(join(schemaDir, file), body, 'utf8');
  }

  const index = {
    generated_by: '@cedrus/contracts scripts/generate-json-schemas.ts',
    dialect: 'https://json-schema.org/draft/2020-12/schema',
    contracts: CONTRACTS.map((c) => ({
      name: c.name,
      version: c.version,
      title: c.title,
      file: schemaFileName(c),
      fully_expressed_in_json_schema: c.validator.fullyExpressedInJsonSchema,
      sources: c.sources,
    })),
  };
  writeFileSync(join(schemaDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  process.stdout.write(`wrote ${rendered.length} schemas to schemas/\n`);
};

if (process.argv[1] !== undefined && process.argv[1].endsWith('generate-json-schemas.ts')) {
  main();
}
