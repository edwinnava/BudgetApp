import type { SQLiteDatabase } from 'expo-sqlite';
import { CARD_PAYMENT_CATEGORY, normalizeMerchant, CategoryKind } from '../lib/categorize';
import { ISODate, monthRange, today } from '../lib/dates';
import type { Frequency } from '../lib/recurring';
import { notifyChange } from './events';

export type AccountType = 'checking' | 'savings' | 'credit' | 'loan' | 'investment';
export const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'credit', 'loan', 'investment'];

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  balance: number;
  available: number | null;
  balance_date: string | null;
  source: 'simplefin' | 'plaid' | 'manual';
  hidden: number;
}

export interface CardDetails {
  account_id: string;
  statement_balance: number | null;
  statement_day: number | null;
  due_day: number | null;
  min_payment: number | null;
  apr: number | null;
  credit_limit: number | null;
}

export type Card = Account & Omit<CardDetails, 'account_id'> & { owed: number };

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
}

export interface Transaction {
  id: string;
  account_id: string;
  date: ISODate;
  amount: number;
  description: string;
  merchant_key: string;
  category_id: number | null;
  pending: number;
  notes: string;
  account_name: string;
  account_type: AccountType;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  category_kind: CategoryKind | null;
}

export interface Recurring {
  id: number;
  name: string;
  amount: number;
  frequency: Frequency;
  anchor_date: ISODate;
  category_id: number | null;
  merchant_key: string | null;
  notes: string;
  active: number;
}

export interface CardPayment {
  id: number;
  card_account_id: string;
  date: ISODate;
  amount: number;
  transaction_id: string | null;
  note: string;
}

/** Amount owed on a credit/loan account, as a positive number. Banks differ on the sign. */
export function owedFor(balance: number): number {
  return Math.abs(balance);
}

// ---------- settings ----------

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  notifyChange();
}

// ---------- accounts ----------

export function listAccounts(db: SQLiteDatabase, includeHidden = true): Promise<Account[]> {
  return db.getAllAsync<Account>(
    `SELECT * FROM accounts ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY type, institution, name`,
  );
}

export function getAccount(db: SQLiteDatabase, id: string): Promise<Account | null> {
  return db.getFirstAsync<Account>('SELECT * FROM accounts WHERE id = ?', id);
}

export async function createManualAccount(
  db: SQLiteDatabase,
  a: { name: string; institution: string; type: AccountType; balance: number },
): Promise<string> {
  const id = `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db.runAsync(
    `INSERT INTO accounts (id, name, institution, type, balance, balance_date, source) VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
    id, a.name, a.institution, a.type, a.balance, today(),
  );
  notifyChange();
  return id;
}

export async function updateAccount(
  db: SQLiteDatabase,
  id: string,
  patch: Partial<Pick<Account, 'name' | 'type' | 'hidden' | 'balance' | 'institution'>>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await db.runAsync(
    `UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => patch[k] as string | number), id,
  );
  notifyChange();
}

export async function deleteAccount(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
  notifyChange();
}

// ---------- credit cards ----------

export function listCards(db: SQLiteDatabase): Promise<Card[]> {
  return db
    .getAllAsync<Account & Omit<CardDetails, 'account_id'>>(
      `SELECT a.*, d.statement_balance, d.statement_day, d.due_day, d.min_payment, d.apr, d.credit_limit
       FROM accounts a LEFT JOIN card_details d ON d.account_id = a.id
       WHERE a.type = 'credit' AND a.hidden = 0 ORDER BY a.name`,
    )
    .then((rows) => rows.map((r) => ({ ...r, owed: owedFor(r.balance) })));
}

export async function getCard(db: SQLiteDatabase, id: string): Promise<Card | null> {
  const r = await db.getFirstAsync<Account & Omit<CardDetails, 'account_id'>>(
    `SELECT a.*, d.statement_balance, d.statement_day, d.due_day, d.min_payment, d.apr, d.credit_limit
     FROM accounts a LEFT JOIN card_details d ON d.account_id = a.id WHERE a.id = ?`,
    id,
  );
  return r ? { ...r, owed: owedFor(r.balance) } : null;
}

export async function saveCardDetails(db: SQLiteDatabase, d: CardDetails): Promise<void> {
  await db.runAsync(
    `INSERT INTO card_details (account_id, statement_balance, statement_day, due_day, min_payment, apr, credit_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET statement_balance = excluded.statement_balance,
       statement_day = excluded.statement_day, due_day = excluded.due_day, min_payment = excluded.min_payment,
       apr = excluded.apr, credit_limit = excluded.credit_limit`,
    d.account_id, d.statement_balance, d.statement_day, d.due_day, d.min_payment, d.apr, d.credit_limit,
  );
  notifyChange();
}

/** Updates only the provided card fields (creating the row if needed). */
export async function mergeCardDetails(db: SQLiteDatabase, accountId: string, patch: Partial<Omit<CardDetails, 'account_id'>>): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO card_details (account_id) VALUES (?)', accountId);
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  await db.runAsync(
    `UPDATE card_details SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE account_id = ?`,
    ...keys.map((k) => patch[k] as number | null), accountId,
  );
}

export function listCardPayments(db: SQLiteDatabase, cardId?: string, since?: ISODate): Promise<CardPayment[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (cardId) {
    where.push('card_account_id = ?');
    params.push(cardId);
  }
  if (since) {
    where.push('date >= ?');
    params.push(since);
  }
  return db.getAllAsync<CardPayment>(
    `SELECT * FROM card_payments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`,
    ...params,
  );
}

export async function addCardPayment(
  db: SQLiteDatabase,
  p: { cardId: string; date: ISODate; amount: number; transactionId?: string | null; note?: string },
): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO card_payments (card_account_id, date, amount, transaction_id, note) VALUES (?, ?, ?, ?, ?)',
    p.cardId, p.date, p.amount, p.transactionId ?? null, p.note ?? '',
  );
  notifyChange();
}

export async function deleteCardPayment(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM card_payments WHERE id = ?', id);
  notifyChange();
}

export function getPaymentForTransaction(db: SQLiteDatabase, txnId: string): Promise<CardPayment | null> {
  return db.getFirstAsync<CardPayment>('SELECT * FROM card_payments WHERE transaction_id = ?', txnId);
}

export async function deletePaymentForTransaction(db: SQLiteDatabase, txnId: string): Promise<void> {
  await db.runAsync('DELETE FROM card_payments WHERE transaction_id = ?', txnId);
  notifyChange();
}

// ---------- categories & rules ----------

export function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>(
    `SELECT * FROM categories ORDER BY CASE kind WHEN 'expense' THEN 0 WHEN 'income' THEN 1 ELSE 2 END, name = 'Other', name`,
  );
}

export async function createCategory(db: SQLiteDatabase, name: string, kind: CategoryKind = 'expense'): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO categories (name, kind) VALUES (?, ?)', name.trim(), kind);
  notifyChange();
}

export function listRules(db: SQLiteDatabase): Promise<{ pattern: string; categoryName: string }[]> {
  return db.getAllAsync(
    'SELECT r.pattern AS pattern, c.name AS categoryName FROM rules r JOIN categories c ON c.id = r.category_id',
  );
}

// ---------- transactions ----------

const TXN_SELECT = `
  SELECT t.*, a.name AS account_name, a.type AS account_type,
    c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.kind AS category_kind
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id`;

export function listTransactions(
  db: SQLiteDatabase,
  f: { month?: string; search?: string; accountId?: string; categoryId?: number; merchantKey?: string; limit?: number } = {},
): Promise<Transaction[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.month) {
    const { start, end } = monthRange(f.month);
    where.push('t.date BETWEEN ? AND ?');
    params.push(start, end);
  }
  if (f.search) {
    where.push('(t.description LIKE ? OR t.notes LIKE ? OR c.name LIKE ?)');
    const q = `%${f.search}%`;
    params.push(q, q, q);
  }
  if (f.accountId) {
    where.push('t.account_id = ?');
    params.push(f.accountId);
  }
  if (f.categoryId != null) {
    where.push(f.categoryId === -1 ? 't.category_id IS NULL' : 't.category_id = ?');
    if (f.categoryId !== -1) params.push(f.categoryId);
  }
  if (f.merchantKey) {
    where.push('t.merchant_key = ?');
    params.push(f.merchantKey);
  }
  return db.getAllAsync<Transaction>(
    `${TXN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.rowid DESC LIMIT ?`,
    ...params, f.limit ?? 500,
  );
}

export function getTransaction(db: SQLiteDatabase, id: string): Promise<Transaction | null> {
  return db.getFirstAsync<Transaction>(`${TXN_SELECT} WHERE t.id = ?`, id);
}

/** Sets a category; with `remember`, all past and future transactions from this merchant follow. */
export async function setTransactionCategory(
  db: SQLiteDatabase,
  txn: Pick<Transaction, 'id' | 'merchant_key'>,
  categoryId: number | null,
  remember: boolean,
): Promise<void> {
  await db.runAsync('UPDATE transactions SET category_id = ? WHERE id = ?', categoryId, txn.id);
  if (remember && categoryId != null && txn.merchant_key) {
    await db.runAsync(
      'INSERT INTO rules (pattern, category_id) VALUES (?, ?) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id',
      txn.merchant_key, categoryId,
    );
    await db.runAsync('UPDATE transactions SET category_id = ? WHERE merchant_key = ?', categoryId, txn.merchant_key);
  }
  notifyChange();
}

export async function setTransactionNotes(db: SQLiteDatabase, id: string, notes: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET notes = ? WHERE id = ?', notes, id);
  notifyChange();
}

export async function addManualTransaction(
  db: SQLiteDatabase,
  t: { accountId: string; date: ISODate; amount: number; description: string; categoryId: number | null },
): Promise<void> {
  const id = `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db.runAsync(
    'INSERT INTO transactions (id, account_id, date, amount, description, merchant_key, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, t.accountId, t.date, t.amount, t.description, normalizeMerchant(t.description), t.categoryId,
  );
  notifyChange();
}

export async function deleteTransaction(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
  notifyChange();
}

/** Outflows used for recurring-charge detection. */
export function listOutflowsSince(db: SQLiteDatabase, since: ISODate) {
  return db.getAllAsync<{ id: string; date: ISODate; amount: number; description: string; category_name: string | null }>(
    `SELECT t.id, t.date, t.amount, t.description, c.name AS category_name FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= ? AND t.amount < 0 AND t.pending = 0 AND (c.kind IS NULL OR c.kind = 'expense')`,
    since,
  );
}

// ---------- recurring ----------

export function listRecurring(db: SQLiteDatabase): Promise<Recurring[]> {
  return db.getAllAsync<Recurring>('SELECT * FROM recurring ORDER BY active DESC, name');
}

export function getRecurring(db: SQLiteDatabase, id: number): Promise<Recurring | null> {
  return db.getFirstAsync<Recurring>('SELECT * FROM recurring WHERE id = ?', id);
}

export async function saveRecurring(db: SQLiteDatabase, r: Omit<Recurring, 'id'> & { id?: number }): Promise<void> {
  if (r.id) {
    await db.runAsync(
      `UPDATE recurring SET name = ?, amount = ?, frequency = ?, anchor_date = ?, category_id = ?, merchant_key = ?, notes = ?, active = ? WHERE id = ?`,
      r.name, r.amount, r.frequency, r.anchor_date, r.category_id, r.merchant_key, r.notes, r.active, r.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO recurring (name, amount, frequency, anchor_date, category_id, merchant_key, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      r.name, r.amount, r.frequency, r.anchor_date, r.category_id, r.merchant_key, r.notes, r.active,
    );
  }
  notifyChange();
}

export async function deleteRecurring(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM recurring WHERE id = ?', id);
  notifyChange();
}

export async function dismissRecurringCandidate(db: SQLiteDatabase, merchantKey: string): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO dismissed_recurring (merchant_key) VALUES (?)', merchantKey);
  notifyChange();
}

export async function listDismissedRecurring(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ merchant_key: string }>('SELECT merchant_key FROM dismissed_recurring');
  return new Set(rows.map((r) => r.merchant_key));
}

export function lastChargeFor(db: SQLiteDatabase, merchantKey: string) {
  return db.getFirstAsync<{ date: ISODate; amount: number }>(
    'SELECT date, amount FROM transactions WHERE merchant_key = ? AND amount < 0 ORDER BY date DESC LIMIT 1',
    merchantKey,
  );
}

// ---------- budgets ----------

export interface BudgetLine {
  category_id: number;
  name: string;
  icon: string;
  color: string;
  budget: number | null;
  spent: number;
}

/**
 * Spending per expense category for a month. Refunds (positive amounts) net against spending;
 * uncategorized outflows are reported under category_id -1. Transfers and card payments are excluded
 * so paying a card is never counted twice.
 */
export async function budgetLines(db: SQLiteDatabase, month: string): Promise<BudgetLine[]> {
  const { start, end } = monthRange(month);
  const rows = await db.getAllAsync<BudgetLine>(
    `SELECT c.id AS category_id, c.name, c.icon, c.color, b.amount AS budget,
       COALESCE((SELECT -SUM(t.amount) FROM transactions t WHERE t.category_id = c.id AND t.date BETWEEN ? AND ?), 0) AS spent
     FROM categories c LEFT JOIN budgets b ON b.category_id = c.id
     WHERE c.kind = 'expense'
     ORDER BY b.amount IS NULL, spent DESC, c.name`,
    start, end,
  );
  const unc = await db.getFirstAsync<{ spent: number | null }>(
    'SELECT -SUM(amount) AS spent FROM transactions WHERE category_id IS NULL AND amount < 0 AND date BETWEEN ? AND ?',
    start, end,
  );
  if (unc?.spent) {
    rows.push({ category_id: -1, name: 'Uncategorized', icon: 'help-circle', color: '#94a3b8', budget: null, spent: unc.spent });
  }
  return rows;
}

export async function monthIncome(db: SQLiteDatabase, month: string): Promise<number> {
  const { start, end } = monthRange(month);
  const r = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE c.kind = 'income' AND t.date BETWEEN ? AND ?`,
    start, end,
  );
  return r?.total ?? 0;
}

export async function setBudget(db: SQLiteDatabase, categoryId: number, amount: number | null): Promise<void> {
  if (amount == null || amount <= 0) await db.runAsync('DELETE FROM budgets WHERE category_id = ?', categoryId);
  else
    await db.runAsync(
      'INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount',
      categoryId, amount,
    );
  notifyChange();
}

export async function getCategoryIdByName(db: SQLiteDatabase, name: string): Promise<number | null> {
  const r = await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ?', name);
  return r?.id ?? null;
}

export const cardPaymentCategoryId = (db: SQLiteDatabase) => getCategoryIdByName(db, CARD_PAYMENT_CATEGORY);

export async function resetAllData(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    DELETE FROM card_payments; DELETE FROM transactions; DELETE FROM card_details; DELETE FROM accounts;
    DELETE FROM recurring; DELETE FROM dismissed_recurring; DELETE FROM budgets; DELETE FROM rules; DELETE FROM settings;
    DELETE FROM plaid_items;`);
  notifyChange();
}

/** Net transaction amount on an account after a date (used to back out a statement balance). */
export async function sumTransactionsAfter(db: SQLiteDatabase, accountId: string, date: ISODate): Promise<number> {
  const r = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM transactions WHERE account_id = ? AND date > ? AND pending = 0',
    accountId, date,
  );
  return r?.total ?? 0;
}

/** Total sent to all cards per month, newest first. */
export function cardPaymentsByMonth(db: SQLiteDatabase, since: ISODate) {
  return db.getAllAsync<{ month: string; total: number }>(
    `SELECT substr(date, 1, 7) AS month, SUM(amount) AS total FROM card_payments WHERE date >= ?
     GROUP BY month ORDER BY month DESC`,
    since,
  );
}
