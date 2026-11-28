import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Migration = { readonly name: string; readonly source: string };
type MigrationFingerprintModule = {
  readonly digestMigrations: (migrations: readonly Migration[]) => string;
  readonly assertAppliedMigrationSourcesUnchanged: (input: {
    readonly previousFingerprint: string | undefined;
    readonly appliedMigrationNames: ReadonlySet<string>;
    readonly migrations: readonly Migration[];
  }) => void;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fingerprintModule = import(
  pathToFileURL(path.join(repoRoot, 'scripts/migration-fingerprint.mjs')).href
) as Promise<MigrationFingerprintModule>;

const history: readonly Migration[] = [
  { name: '0001_wallets.sql', source: 'CREATE TABLE wallets (id TEXT);' },
  { name: '0002_grants.sql', source: 'CREATE TABLE grants (id TEXT);' },
];
const baseline: Migration = {
  name: '0001_signer_d1_baseline.sql',
  source: 'CREATE TABLE IF NOT EXISTS wallets (id TEXT);',
};

test('a rewritten applied migration is refused', async () => {
  const module = await fingerprintModule;
  expect(() =>
    module.assertAppliedMigrationSourcesUnchanged({
      previousFingerprint: module.digestMigrations(history),
      appliedMigrationNames: new Set(history.map((migration) => migration.name)),
      migrations: [history[0], { ...history[1], source: 'CREATE TABLE grants (id INTEGER);' }],
    }),
  ).toThrow(/sources changed/u);
});

test('a baseline that no database has applied replaces the applied history', async () => {
  const module = await fingerprintModule;
  const applied = new Set(history.map((migration) => migration.name));
  expect(() =>
    module.assertAppliedMigrationSourcesUnchanged({
      previousFingerprint: module.digestMigrations(history),
      appliedMigrationNames: applied,
      migrations: [baseline],
    }),
  ).not.toThrow();
  // After the baseline runs, its own source is checked as any applied migration.
  applied.add(baseline.name);
  expect(() =>
    module.assertAppliedMigrationSourcesUnchanged({
      previousFingerprint: module.digestMigrations([baseline]),
      appliedMigrationNames: applied,
      migrations: [{ ...baseline, source: 'CREATE TABLE wallets (id INTEGER);' }],
    }),
  ).toThrow(/sources changed/u);
});

test('a set that drops the history without a baseline is refused', async () => {
  const module = await fingerprintModule;
  expect(() =>
    module.assertAppliedMigrationSourcesUnchanged({
      previousFingerprint: module.digestMigrations(history),
      appliedMigrationNames: new Set(history.map((migration) => migration.name)),
      migrations: [{ name: '0001_signer_schema.sql', source: baseline.source }],
    }),
  ).toThrow(/sources changed/u);
});
