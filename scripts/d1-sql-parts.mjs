// Parts of a migration that fit in one D1 call. One `wrangler d1 execute --command` carries the
// SQL as one process argument, which Linux limits to 128 KiB (spawn fails with E2BIG), and the
// largest migration that D1 took in one call was 98 KB. The signer baseline of @seams/host
// 0.77.0 is 436 KB.

import { isBaselineMigrationName } from './migration-fingerprint.mjs';

/** The most SQL bytes that one call carries. */
export const MAX_SQL_BYTES_PER_CALL = 90_000;

/**
 * The top-level statements of `source`, each with its `;`. A `;` inside a quoted text, a comment
 * or a `BEGIN ... END` or `CASE ... END` block (a trigger body) does not end a statement. Comments
 * between statements go with the statement that follows them.
 */
export function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '-' && next === '-') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error('SQL has an unclosed block comment');
      index = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(source, index, char);
      continue;
    }
    if (char === '[') {
      const end = source.indexOf(']', index + 1);
      if (end < 0) throw new Error('SQL has an unclosed [identifier]');
      index = end + 1;
      continue;
    }
    if (isWordStart(char) && !isWordChar(source[index - 1])) {
      let end = index + 1;
      while (end < source.length && isWordChar(source[end])) end += 1;
      const word = source.slice(index, end).toUpperCase();
      if (word === 'BEGIN' || word === 'CASE') depth += 1;
      else if (word === 'END') {
        depth -= 1;
        if (depth < 0) throw new Error('SQL has an END with no BEGIN or CASE');
      }
      index = end;
      continue;
    }
    if (char === ';' && depth === 0) {
      statements.push(source.slice(start, index + 1).trim());
      start = index + 1;
    }
    index += 1;
  }
  if (depth !== 0) throw new Error('SQL has a BEGIN or CASE with no END');
  if (
    source
      .slice(start)
      .replace(/--[^\n]*/gu, '')
      .trim()
  ) {
    throw new Error('SQL ends with a statement that has no ";"');
  }
  return statements;
}

/** Groups statements in order into parts of at most `maxBytes` UTF-8 bytes each. */
export function packSqlStatements(statements, maxBytes = MAX_SQL_BYTES_PER_CALL) {
  const parts = [];
  let current = '';
  for (const statement of statements) {
    if (Buffer.byteLength(statement) > maxBytes) {
      throw new Error(`one SQL statement has more than ${maxBytes} bytes`);
    }
    const joined = current ? `${current}\n${statement}` : statement;
    if (Buffer.byteLength(joined) > maxBytes) {
      parts.push(current);
      current = statement;
    } else {
      current = joined;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The SQL of each D1 call of a migration, with the row of `d1_migrations`. The query API keeps
 * table rebuilds and their history in one transaction, so a migration is one call. Only a
 * baseline may need more than one call: its statements are idempotent, so it runs in parts, and
 * its history row comes with the last part.
 */
export function migrationCalls(migration) {
  const historyStatement = `INSERT INTO d1_migrations (name) VALUES (${sqlText(migration.name)});`;
  const whole = `${migration.source.trimEnd()}\n\n${historyStatement}\n`;
  if (Buffer.byteLength(whole) <= MAX_SQL_BYTES_PER_CALL) return [whole];
  if (!isBaselineMigrationName(migration.name)) {
    throw new Error(
      `${migration.name} has more than ${MAX_SQL_BYTES_PER_CALL} bytes, the most that one D1 call carries; split it into smaller migrations`,
    );
  }
  return packSqlStatements([...splitSqlStatements(migration.source), historyStatement]);
}

/** A SQL text literal. */
export function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function skipQuoted(source, index, quote) {
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === quote) {
      // A doubled quote is a quote inside the text.
      if (source[cursor + 1] === quote) cursor += 2;
      else return cursor + 1;
    } else {
      cursor += 1;
    }
  }
  throw new Error('SQL has an unclosed quoted text');
}

function isWordStart(char) {
  return char !== undefined && /[A-Za-z_]/u.test(char);
}

function isWordChar(char) {
  return char !== undefined && /[A-Za-z0-9_$]/u.test(char);
}
