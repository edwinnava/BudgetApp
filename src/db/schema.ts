import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_CATEGORIES } from '../lib/categorize';

/** Ordered migrations; index + 1 is the schema version stored in PRAGMA user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'checking',      -- checking | savings | credit | loan | investment
    balance REAL NOT NULL DEFAULT 0,             -- as reported; credit cards are usually negative
    available REAL,
    balance_date TEXT,
    source TEXT NOT NULL DEFAULT 'manual',       -- simplefin | manual
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE card_details (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    statement_balance REAL,
    statement_day INTEGER,                       -- day of month the statement closes
    due_day INTEGER,                             -- day of month payment is due
    min_payment REAL,
    apr REAL,
    credit_limit REAL
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT 'pricetag',
    color TEXT NOT NULL DEFAULT '#94a3b8',
    kind TEXT NOT NULL DEFAULT 'expense'         -- expense | income | transfer
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount REAL NOT NULL,                        -- negative = money out of this account
    description TEXT NOT NULL,
    merchant_key TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    pending INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_txn_date ON transactions(date);
  CREATE INDEX idx_txn_account ON transactions(account_id, date);
  CREATE INDEX idx_txn_merchant ON transactions(merchant_key);

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,                        -- positive expected charge
    frequency TEXT NOT NULL,
    anchor_date TEXT NOT NULL,                   -- any known due date; future dates are derived
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    merchant_key TEXT,                           -- links matching transactions
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE dismissed_recurring (merchant_key TEXT PRIMARY KEY NOT NULL);

  CREATE TABLE budgets (
    category_id INTEGER PRIMARY KEY NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount REAL NOT NULL
  );

  CREATE TABLE card_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_id TEXT UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_card_payments ON card_payments(card_account_id, date);

  CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `,
  `
  -- Linked Plaid logins. The access token itself lives in the device keychain/keystore.
  CREATE TABLE plaid_items (
    item_id TEXT PRIMARY KEY NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    cursor TEXT,
    last_sync TEXT,
    error TEXT
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    // Runs before any screen mounts, so a plain transaction is safe (exclusive ones are native-only).
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      if (version === 0) {
        for (const c of DEFAULT_CATEGORIES) {
          await db.runAsync(
            'INSERT OR IGNORE INTO categories (name, icon, color, kind) VALUES (?, ?, ?, ?)',
            c.name, c.icon, c.color, c.kind,
          );
        }
      }
    });
    version++;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
