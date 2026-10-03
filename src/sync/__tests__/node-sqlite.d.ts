// Minimal types for Node's built-in SQLite, used only by integration tests.
// (Avoids pulling @types/node into the React Native type environment.)
declare module 'node:sqlite' {
  type Value = string | number | bigint | null | Uint8Array;
  interface StatementSync {
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: Value[]): unknown;
    all(...params: Value[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
