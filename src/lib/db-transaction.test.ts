import { describe, expect, it, vi } from 'vitest';
import { buildWriteTransaction, runWriteTransaction, type TxStatement } from '@/lib/db-transaction.ts';

describe('buildWriteTransaction', () => {
  it('returns null when there is nothing to write', () => {
    expect(buildWriteTransaction([])).toBeNull();
    expect(buildWriteTransaction([{ sql: '   ' }, { sql: '' }])).toBeNull();
  });

  it('wraps statements in BEGIN/COMMIT and normalises trailing semicolons', () => {
    const built = buildWriteTransaction([
      { sql: 'DELETE $a;' },
      { sql: 'CREATE $b CONTENT $c' },
    ]);
    expect(built).not.toBeNull();
    expect(built!.sql).toBe(
      'BEGIN TRANSACTION;\nDELETE $a;\nCREATE $b CONTENT $c;\nCOMMIT TRANSACTION;',
    );
  });

  it('merges bind vars from every statement', () => {
    const built = buildWriteTransaction([
      { sql: 'DELETE $a', vars: { a: 1 } },
      { sql: 'CREATE $b CONTENT $c', vars: { b: 'x', c: { n: 2 } } },
    ]);
    expect(built!.vars).toEqual({ a: 1, b: 'x', c: { n: 2 } });
  });

  it('throws on a duplicate bind var name across statements', () => {
    const statements: TxStatement[] = [
      { sql: 'DELETE $id', vars: { id: 1 } },
      { sql: 'DELETE $id', vars: { id: 2 } },
    ];
    expect(() => buildWriteTransaction(statements)).toThrow(/duplicate bind var "\$id"/);
  });
});

describe('runWriteTransaction', () => {
  it('sends one query with the combined statement text and vars', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    await runWriteTransaction(db, [
      { sql: 'DELETE $a', vars: { a: 1 } },
      { sql: 'UPDATE $b MERGE $c', vars: { b: 2, c: { x: 1 } } },
    ]);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, vars] = db.query.mock.calls[0];
    expect(sql).toMatch(/^BEGIN TRANSACTION;/);
    expect(sql).toMatch(/COMMIT TRANSACTION;$/);
    expect(vars).toEqual({ a: 1, b: 2, c: { x: 1 } });
  });

  it('does not hit the database when there are no statements', async () => {
    const db = { query: vi.fn() };
    await runWriteTransaction(db, []);
    expect(db.query).not.toHaveBeenCalled();
  });
});
