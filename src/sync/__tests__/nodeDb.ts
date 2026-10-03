import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/** Minimal expo-sqlite-compatible wrapper over Node's built-in SQLite, for integration tests. */
export function createTestDb(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as (string | number | null)[];
  const api = {
    execAsync: async (sql: string) => void db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...flat(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...flat(params)) ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...flat(params)),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}
