/**
 * Run several write statements as a single SurrealDB transaction.
 *
 * The POS persists an order and its side-tables (taxes, discounts, payments,
 * kitchen rows, ledger entries) as a series of independent `db.create` /
 * `db.merge` / `db.delete` calls. If the socket drops or the tab is closed
 * mid-sequence, the order is left half-written — orphaned children, stale
 * denormalised totals.
 *
 * `runWriteTransaction` sends the whole set in one `query` round-trip wrapped in
 * `BEGIN TRANSACTION … COMMIT TRANSACTION`. SurrealDB rolls the batch back if
 * any statement fails, so a partial write cannot be committed.
 *
 * Callers pass raw statements with bound parameters. Bind-var names must be
 * unique across the whole set (the helper merges them into one params object
 * and throws on a collision) — in a loop, suffix them with the index.
 */

export interface TxStatement {
  /** A single SurrealQL write statement, no trailing semicolon needed. */
  sql: string;
  /** Bound parameters referenced by this statement. Names unique across the set. */
  vars?: Record<string, unknown>;
}

export interface TxRunner {
  query: <R extends unknown[] = unknown[]>(
    sql: string,
    vars?: Record<string, unknown>,
  ) => Promise<R>;
}

/** Build the `BEGIN … COMMIT` text and merged params without running it (exposed for tests). */
export function buildWriteTransaction(statements: TxStatement[]): {
  sql: string;
  vars: Record<string, unknown>;
} | null {
  const real = statements.filter((s) => s && typeof s.sql === 'string' && s.sql.trim());
  if (real.length === 0) return null;

  const vars: Record<string, unknown> = {};
  for (const statement of real) {
    for (const [key, value] of Object.entries(statement.vars ?? {})) {
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        throw new Error(`runWriteTransaction: duplicate bind var "$${key}"`);
      }
      vars[key] = value;
    }
  }

  const body = real.map((s) => s.sql.trim().replace(/;+\s*$/, '')).join(';\n');
  return { sql: `BEGIN TRANSACTION;\n${body};\nCOMMIT TRANSACTION;`, vars };
}

export async function runWriteTransaction(
  db: TxRunner,
  statements: TxStatement[],
): Promise<void> {
  const built = buildWriteTransaction(statements);
  if (!built) return;
  await db.query(built.sql, built.vars);
}
