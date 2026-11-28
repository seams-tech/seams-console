import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Migration = { readonly name: string; readonly source: string };
type D1SqlPartsModule = {
  readonly MAX_SQL_BYTES_PER_CALL: number;
  readonly splitSqlStatements: (source: string) => string[];
  readonly migrationCalls: (migration: Migration) => string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const partsModule = import(
  pathToFileURL(path.join(repoRoot, 'scripts/d1-sql-parts.mjs')).href
) as Promise<D1SqlPartsModule>;

function signerBaseline(): Migration {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const root = path.dirname(require.resolve('@seams/host/package.json'));
  const name = '0001_signer_d1_baseline.sql';
  return { name, source: readFileSync(path.join(root, 'migrations/d1-signer', name), 'utf8') };
}

function schemaOf(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as { type: string; name: string; sql: string | null }[];
  return rows.map((row) => `${row.type} ${row.name} ${row.sql ?? ''}`);
}

function databaseWithHistory(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
  );
  return database;
}

test('a statement ends only at a top-level semicolon', async () => {
  const module = await partsModule;
  const statements = module.splitSqlStatements(`-- a comment; with a semicolon
CREATE TABLE a (v TEXT DEFAULT 'x;y', "b;c" INTEGER);
/* a block; comment */
CREATE TRIGGER IF NOT EXISTS a_guard BEFORE DELETE ON a
BEGIN
  SELECT CASE WHEN old.v = 'end' THEN RAISE(ABORT, 'no; delete') END;
END;
INSERT OR IGNORE INTO a (v) VALUES ('it''s; fine');
`);
  expect(statements).toHaveLength(3);
  expect(statements[1]).toMatch(/^\/\* a block; comment \*\/\nCREATE TRIGGER[\s\S]*END;$/u);
  expect(() => module.splitSqlStatements('CREATE TABLE a (v TEXT)')).toThrow(/no ";"/u);
});

test('the signer baseline runs in parts that give the schema of the whole file', async () => {
  const module = await partsModule;
  const baseline = signerBaseline();
  const calls = module.migrationCalls(baseline);
  expect(calls.length).toBeGreaterThan(1);
  for (const call of calls) {
    expect(Buffer.byteLength(call)).toBeLessThanOrEqual(module.MAX_SQL_BYTES_PER_CALL);
  }
  expect(calls[0]).toContain('DROP TABLE signer_baseline_guard;');
  expect(calls.at(-1)).toMatch(
    /INSERT INTO d1_migrations \(name\) VALUES \('0001_signer_d1_baseline\.sql'\);$/u,
  );

  const whole = databaseWithHistory();
  whole.exec(baseline.source);
  const inParts = databaseWithHistory();
  for (const call of calls) inParts.exec(call);
  expect(schemaOf(inParts)).toEqual(schemaOf(whole));

  // A run that stops after some parts can run again from the first part.
  for (const call of calls) inParts.exec(call);
  expect(schemaOf(inParts)).toEqual(schemaOf(whole));
});

test('only a baseline may need more than one call', async () => {
  const module = await partsModule;
  const small = { name: '0002_small.sql', source: 'CREATE TABLE a (v TEXT);' };
  expect(module.migrationCalls(small)).toEqual([
    "CREATE TABLE a (v TEXT);\n\nINSERT INTO d1_migrations (name) VALUES ('0002_small.sql');\n",
  ]);
  const large = {
    name: '0003_large.sql',
    source: `INSERT INTO a (v) VALUES ('${'x'.repeat(50_000)}');\n`.repeat(2),
  };
  expect(() => module.migrationCalls(large)).toThrow(/split it into smaller migrations/u);
});
