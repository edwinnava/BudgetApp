import type { SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { mergeCardDetails, setSetting, AccountType } from '../db/repo';
import { notifyChange } from '../db/events';
import { today } from '../lib/dates';
import {
  accountBalance, accountName, cardDetailsFromPlaid, mapAccountType, mapTransaction, plaidAccountId, plaidTxnId,
  PlaidSyncResponse,
} from '../lib/plaidMap';
import { ingestTransactions } from './ingest';

const SERVER_URL_KEY = 'plaid_server_url';
const APP_SECRET_KEY = 'plaid_app_secret';
const tokenKey = (itemId: string) => `plaid_token_${itemId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export interface PlaidItem {
  item_id: string;
  institution: string;
  cursor: string | null;
  last_sync: string | null;
  error: string | null;
}

export class PlaidServerError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ---------- server config ----------

export async function getPlaidServer(): Promise<{ url: string; secret: string } | null> {
  try {
    const [url, secret] = await Promise.all([SecureStore.getItemAsync(SERVER_URL_KEY), SecureStore.getItemAsync(APP_SECRET_KEY)]);
    return url && secret ? { url, secret } : null;
  } catch {
    return null; // secure storage unavailable (web preview)
  }
}

/** Saves the worker URL + app secret after checking that the worker accepts them. */
export async function savePlaidServer(url: string, secret: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(clean)) throw new Error('The server URL must start with https://');
  const res = await fetch(`${clean}/link-token-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret.trim()}` },
  });
  if (res.status === 401) throw new Error('The server rejected the app secret.');
  if (res.status !== 404 && !res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message ?? `Server check failed (HTTP ${res.status}).`);
  }
  await SecureStore.setItemAsync(SERVER_URL_KEY, clean);
  await SecureStore.setItemAsync(APP_SECRET_KEY, secret.trim());
  notifyChange();
}

async function call<T>(path: string, body: object): Promise<T> {
  const server = await getPlaidServer();
  if (!server) throw new Error('Set up your Plaid server in Settings first.');
  let res: Response;
  try {
    res = await fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach your Plaid server. Check your connection and the server URL.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new PlaidServerError(data.error ?? `HTTP_${res.status}`, data.message ?? `Request failed (HTTP ${res.status}).`);
  return data as T;
}

// ---------- items ----------

export function listPlaidItems(db: SQLiteDatabase): Promise<PlaidItem[]> {
  return db.getAllAsync<PlaidItem>('SELECT * FROM plaid_items ORDER BY institution');
}

/**
 * Opens Plaid Link. With `item`, runs update mode to re-authenticate a login that needs attention.
 * Resolves true when a bank was linked (or reconnected).
 */
export async function openPlaidLink(db: SQLiteDatabase, item?: PlaidItem): Promise<boolean> {
  let sdk: typeof import('react-native-plaid-link-sdk');
  try {
    sdk = await import('react-native-plaid-link-sdk');
  } catch {
    throw new Error('Linking banks with Plaid needs the installed app build (it does not work in Expo Go).');
  }
  const accessToken = item ? await SecureStore.getItemAsync(tokenKey(item.item_id)) : null;
  const { linkToken } = await call<{ linkToken: string }>('/link-token', accessToken ? { accessToken } : {});

  return new Promise<boolean>((resolve, reject) => {
    sdk
      .createPlaidLinkSession({
        token: linkToken,
        onSuccess: async (success) => {
          try {
            if (item) {
              await db.runAsync('UPDATE plaid_items SET error = NULL WHERE item_id = ?', item.item_id);
            } else {
              const { accessToken: token, itemId } = await call<{ accessToken: string; itemId: string }>('/exchange', {
                publicToken: success.publicToken,
              });
              await SecureStore.setItemAsync(tokenKey(itemId), token);
              await db.runAsync(
                'INSERT OR REPLACE INTO plaid_items (item_id, institution) VALUES (?, ?)',
                itemId, success.metadata.institution?.name ?? 'Bank',
              );
            }
            notifyChange();
            resolve(true);
          } catch (e) {
            reject(e);
          }
        },
        onExit: (exit) => {
          if (exit.error) reject(new Error(exit.error.displayMessage || exit.error.errorMessage));
          else resolve(false);
        },
        onEvent: () => {},
      })
      .then((session) => session.open())
      .catch(reject);
  });
}

export async function removePlaidItem(db: SQLiteDatabase, item: PlaidItem, deleteData: boolean): Promise<void> {
  const token = await SecureStore.getItemAsync(tokenKey(item.item_id));
  if (token) {
    try {
      await call('/remove', { accessToken: token });
    } catch {
      // Still forget it locally; the Item can also be removed from the Plaid dashboard.
    }
    await SecureStore.deleteItemAsync(tokenKey(item.item_id));
  }
  if (deleteData) {
    await db.runAsync("DELETE FROM accounts WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(await itemAccountIds(db, item.item_id)));
  }
  await db.runAsync('DELETE FROM plaid_items WHERE item_id = ?', item.item_id);
  notifyChange();
}

async function itemAccountIds(db: SQLiteDatabase, itemId: string): Promise<string[]> {
  const raw = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', `plaid_accounts_${itemId}`);
  return raw ? (JSON.parse(raw.value) as string[]) : [];
}

/** Forgets every linked login on this device (used by "Erase all data"). */
export async function forgetAllPlaidItems(db: SQLiteDatabase): Promise<void> {
  for (const item of await listPlaidItems(db)) {
    await SecureStore.deleteItemAsync(tokenKey(item.item_id)).catch(() => {});
  }
}

// ---------- sync ----------

export interface PlaidSyncResult {
  items: number;
  added: number;
  errors: string[];
}

async function syncItem(db: SQLiteDatabase, item: PlaidItem): Promise<number> {
  const accessToken = await SecureStore.getItemAsync(tokenKey(item.item_id));
  if (!accessToken) throw new PlaidServerError('MISSING_TOKEN', 'This login is missing its key on this device. Remove it and link it again.');
  const r = await call<PlaidSyncResponse>('/sync', { accessToken, cursor: item.cursor });

  const types = new Map<string, AccountType>();
  for (const a of r.accounts) {
    const id = plaidAccountId(a.id);
    const existing = await db.getFirstAsync<{ type: AccountType }>('SELECT type FROM accounts WHERE id = ?', id);
    const type = existing?.type ?? mapAccountType(a.type, a.subtype);
    types.set(a.id, type);
    if (existing) {
      await db.runAsync(
        'UPDATE accounts SET balance = ?, available = ?, balance_date = ?, institution = ? WHERE id = ?',
        accountBalance(a), a.available, today(), item.institution, id,
      );
    } else {
      await db.runAsync(
        `INSERT INTO accounts (id, name, institution, type, balance, available, balance_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'plaid')`,
        id, accountName(a), item.institution, type, accountBalance(a), a.available, today(),
      );
    }
    if (type === 'credit') {
      await mergeCardDetails(db, id, cardDetailsFromPlaid(a, r.liabilities?.find((l) => l.accountId === a.id)));
    }
  }
  await setSetting(db, `plaid_accounts_${item.item_id}`, JSON.stringify(r.accounts.map((a) => plaidAccountId(a.id))));

  let added = 0;
  const byAccount = new Map<string, typeof r.added>();
  for (const t of [...r.added, ...r.modified]) {
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  }
  for (const [plaidAcct, txns] of byAccount) {
    const type = types.get(plaidAcct) ?? 'checking';
    added += await ingestTransactions(db, { id: plaidAccountId(plaidAcct), type }, txns.map((t) => mapTransaction(t, type)));
  }
  for (const id of r.removed) {
    await db.runAsync('DELETE FROM transactions WHERE id = ?', plaidTxnId(id));
  }
  await db.runAsync(
    'UPDATE plaid_items SET cursor = ?, last_sync = ?, error = NULL WHERE item_id = ?',
    r.nextCursor, new Date().toISOString(), item.item_id,
  );
  return added;
}

export async function syncPlaid(db: SQLiteDatabase): Promise<PlaidSyncResult> {
  const items = await listPlaidItems(db);
  const result: PlaidSyncResult = { items: items.length, added: 0, errors: [] };
  for (const item of items) {
    try {
      result.added += await syncItem(db, item);
    } catch (e) {
      const code = e instanceof PlaidServerError ? e.code : 'ERROR';
      const message = e instanceof Error ? e.message : String(e);
      await db.runAsync('UPDATE plaid_items SET error = ? WHERE item_id = ?', code === 'ITEM_LOGIN_REQUIRED' ? code : message, item.item_id);
      result.errors.push(`${item.institution}: ${code === 'ITEM_LOGIN_REQUIRED' ? 'needs you to log in again (tap Reconnect in Settings)' : message}`);
    }
  }
  notifyChange();
  return result;
}
