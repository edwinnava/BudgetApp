import type { SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { CARD_PAYMENT_CATEGORY, guessCategory, normalizeMerchant } from '../lib/categorize';
import { addDays, ISODate, today } from '../lib/dates';
import { claimAccessUrl, fetchAccounts, normalizeAccountSet } from '../lib/simplefin';
import { csvTransactionId, ParsedRow } from '../lib/csv';
import { getSetting, listCategories, listRules, setSetting, AccountType } from '../db/repo';
import { notifyChange } from '../db/events';

export interface IncomingTxn {
  id: string;
  date: ISODate;
  amount: number;
  description: string;
  pending: boolean;
  /** The bank's own category, mapped to an app category name. */
  hint?: string | null;
  /** A pending transaction this one replaces; its category and notes carry over. */
  inheritFrom?: string | null;
}

/**
 * Inserts or updates transactions for one account. New transactions are auto-categorized;
 * existing ones keep the user's category and notes. Payments received on a credit card
 * are recorded in card_payments so the payoff tracker sees them.
 */
export async function ingestTransactions(
  db: SQLiteDatabase,
  account: { id: string; type: AccountType },
  txns: IncomingTxn[],
): Promise<number> {
  const rules = await listRules(db);
  const categories = await listCategories(db);
  const idByName = new Map(categories.map((c) => [c.name, c.id]));
  const cardPaymentId = idByName.get(CARD_PAYMENT_CATEGORY) ?? null;
  let added = 0;

  await db.withTransactionAsync(async () => {
    for (const t of txns) {
      const existing = await db.getFirstAsync<{ category_id: number | null }>(
        'SELECT category_id FROM transactions WHERE id = ?', t.id,
      );
      const merchantKey = normalizeMerchant(t.description);
      let categoryId = existing?.category_id ?? null;
      if (existing) {
        await db.runAsync(
          'UPDATE transactions SET date = ?, amount = ?, description = ?, merchant_key = ?, pending = ? WHERE id = ?',
          t.date, t.amount, t.description, merchantKey, t.pending ? 1 : 0, t.id,
        );
      } else {
        const parent = t.inheritFrom
          ? await db.getFirstAsync<{ category_id: number | null; notes: string }>(
              'SELECT category_id, notes FROM transactions WHERE id = ?', t.inheritFrom,
            )
          : null;
        if (parent?.category_id != null) categoryId = parent.category_id;
        else {
          const name = guessCategory({ description: t.description, amount: t.amount, accountType: account.type }, rules, t.hint);
          categoryId = name ? (idByName.get(name) ?? null) : null;
        }
        await db.runAsync(
          `INSERT INTO transactions (id, account_id, date, amount, description, merchant_key, category_id, pending, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.id, account.id, t.date, t.amount, t.description, merchantKey, categoryId, t.pending ? 1 : 0, parent?.notes ?? '',
        );
        added++;
      }
      if (account.type === 'credit' && categoryId === cardPaymentId && t.amount > 0 && !t.pending) {
        // A payment the user logged by hand is replaced by the synced one once it posts.
        await db.runAsync(
          `DELETE FROM card_payments WHERE card_account_id = ? AND transaction_id IS NULL AND ABS(amount - ?) < 0.01
           AND date BETWEEN date(?, '-7 day') AND date(?, '+3 day')
           AND NOT EXISTS (SELECT 1 FROM card_payments WHERE transaction_id = ?)`,
          account.id, t.amount, t.date, t.date, t.id,
        );
        await db.runAsync(
          `INSERT INTO card_payments (card_account_id, date, amount, transaction_id) VALUES (?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET date = excluded.date, amount = excluded.amount`,
          account.id, t.date, t.amount, t.id,
        );
      }
    }
  });
  return added;
}

// ---------- SimpleFIN ----------

const ACCESS_KEY = 'simplefin_access_url';

export async function isSimpleFinConnected(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(ACCESS_KEY));
  } catch {
    return false; // secure storage unavailable (e.g. web preview)
  }
}

export async function connectSimpleFin(setupToken: string): Promise<void> {
  const accessUrl = await claimAccessUrl(setupToken);
  await SecureStore.setItemAsync(ACCESS_KEY, accessUrl);
}

export async function disconnectSimpleFin(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
}

export interface SyncResult {
  accounts: number;
  added: number;
  errors: string[];
}

export async function syncSimpleFin(db: SQLiteDatabase): Promise<SyncResult> {
  const accessUrl = await SecureStore.getItemAsync(ACCESS_KEY);
  if (!accessUrl) throw new Error('Connect SimpleFIN in Settings first.');
  const last = await getSetting(db, 'last_sync_date');
  // First sync pulls 90 days; later syncs overlap a week to pick up late-posting transactions.
  const start = last ? addDays(last, -7) : addDays(today(), -90);
  const set = await fetchAccounts(accessUrl, new Date(`${start}T00:00:00`));
  const accounts = normalizeAccountSet(set);
  let added = 0;

  for (const a of accounts) {
    const id = `sf:${a.externalId}`;
    const existing = await db.getFirstAsync<{ type: AccountType }>('SELECT type FROM accounts WHERE id = ?', id);
    const type = existing?.type ?? a.guessedType;
    if (existing) {
      await db.runAsync(
        'UPDATE accounts SET balance = ?, available = ?, balance_date = ?, institution = ? WHERE id = ?',
        a.balance, a.available, a.balanceDate, a.institution, id,
      );
    } else {
      await db.runAsync(
        `INSERT INTO accounts (id, name, institution, type, balance, available, balance_date, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'simplefin')`,
        id, a.name, a.institution, type, a.balance, a.available, a.balanceDate,
      );
    }
    const incoming = a.transactions.map((t) => ({ ...t, id: `${id}:${t.externalId}` }));
    // Pending transactions often get a new id once posted; drop stale pending rows in the window.
    const ids = incoming.map((t) => t.id);
    await db.runAsync(
      `DELETE FROM transactions WHERE account_id = ? AND pending = 1 AND date >= ?
       AND id NOT IN (${ids.map(() => '?').join(',') || "''"})`,
      id, start, ...ids,
    );
    added += await ingestTransactions(db, { id, type }, incoming);
  }
  await setSetting(db, 'last_sync_date', today());
  await setSetting(db, 'last_sync_at', new Date().toISOString());
  notifyChange();
  return { accounts: accounts.length, added, errors: set.errors ?? [] };
}

// ---------- CSV ----------

export async function importCsvRows(
  db: SQLiteDatabase,
  account: { id: string; type: AccountType },
  rows: ParsedRow[],
): Promise<number> {
  const seen = new Map<string, number>();
  const txns = rows.map((r) => {
    const k = `${r.date}|${r.amount}|${r.description}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { id: csvTransactionId(account.id, r, n), date: r.date, amount: r.amount, description: r.description, pending: false };
  });
  const added = await ingestTransactions(db, account, txns);
  notifyChange();
  return added;
}

/** Re-derives card payments for a card account (e.g. after its type is changed to credit). */
export async function backfillCardPayments(db: SQLiteDatabase, accountId: string): Promise<void> {
  const rules = await listRules(db);
  const rows = await db.getAllAsync<{ id: string; description: string; amount: number; category_id: number | null }>(
    'SELECT id, description, amount, category_id FROM transactions WHERE account_id = ? AND amount > 0 AND pending = 0',
    accountId,
  );
  const cats = await listCategories(db);
  const cardPaymentId = cats.find((c) => c.name === CARD_PAYMENT_CATEGORY)?.id;
  if (!cardPaymentId) return;
  for (const r of rows) {
    const isPayment =
      r.category_id === cardPaymentId ||
      guessCategory({ description: r.description, amount: r.amount, accountType: 'credit' }, rules) === CARD_PAYMENT_CATEGORY;
    if (!isPayment) continue;
    await db.runAsync('UPDATE transactions SET category_id = ? WHERE id = ?', cardPaymentId, r.id);
    await db.runAsync(
      `INSERT OR IGNORE INTO card_payments (card_account_id, date, amount, transaction_id)
       SELECT account_id, date, amount, id FROM transactions WHERE id = ?`,
      r.id,
    );
  }
  notifyChange();
}
