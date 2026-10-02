/**
 * SimpleFIN Bridge client (https://beta-bridge.simplefin.org).
 *
 * SimpleFIN lets an app read balances and transactions directly from the device: you
 * connect your banks on the SimpleFIN website, get a one-time "setup token", and the app
 * exchanges it for a private access URL. No server of our own is involved.
 */
import { fromUnixSeconds, ISODate } from './dates';

export interface SFTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SFAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  org?: { name?: string; domain?: string };
  transactions?: SFTransaction[];
}

export interface SFAccountSet {
  errors: string[];
  accounts: SFAccount[];
}

export interface NormalizedAccount {
  externalId: string;
  name: string;
  institution: string;
  balance: number;
  available: number | null;
  balanceDate: ISODate;
  guessedType: 'checking' | 'savings' | 'credit' | 'loan' | 'investment';
  transactions: {
    externalId: string;
    date: ISODate;
    amount: number;
    description: string;
    pending: boolean;
  }[];
}

export function decodeSetupToken(token: string): string {
  const url = atob(token.trim()).trim();
  if (!/^https:\/\//.test(url)) throw new Error('That does not look like a SimpleFIN setup token.');
  return url;
}

/** One-time exchange of a setup token for a long-lived access URL. */
export async function claimAccessUrl(setupToken: string): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 403) throw new Error('This setup token was already used or has expired. Create a new one.');
  if (!res.ok) throw new Error(`Claim failed (HTTP ${res.status}).`);
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\//.test(accessUrl)) throw new Error('Unexpected response from SimpleFIN.');
  return accessUrl;
}

/** Splits `https://user:pass@host/path` into a plain URL plus a Basic auth header. */
export function splitAccessUrl(accessUrl: string): { baseUrl: string; authorization: string } {
  const m = accessUrl.match(/^(https?:\/\/)([^:@/]+):([^@/]+)@(.+)$/);
  if (!m) throw new Error('Invalid SimpleFIN access URL.');
  const [, scheme, user, pass, rest] = m;
  return {
    baseUrl: `${scheme}${rest.replace(/\/$/, '')}`,
    authorization: `Basic ${btoa(`${decodeURIComponent(user)}:${decodeURIComponent(pass)}`)}`,
  };
}

export async function fetchAccounts(accessUrl: string, startDate: Date): Promise<SFAccountSet> {
  const { baseUrl, authorization } = splitAccessUrl(accessUrl);
  const start = Math.floor(startDate.getTime() / 1000);
  const res = await fetch(`${baseUrl}/accounts?start-date=${start}&pending=1`, {
    headers: { Authorization: authorization },
  });
  if (res.status === 403) throw new Error('SimpleFIN access was revoked. Reconnect in Settings.');
  if (res.status === 402) throw new Error('SimpleFIN subscription payment required.');
  if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status}).`);
  return (await res.json()) as SFAccountSet;
}

const CREDIT_HINT = /credit|card|visa|mastercard|amex|express|discover|sapphire|freedom|venture|quicksilver|rewards/i;

export function guessAccountType(a: SFAccount): NormalizedAccount['guessedType'] {
  const n = a.name;
  if (CREDIT_HINT.test(n)) return 'credit';
  if (/saving|money market|mmkt/i.test(n)) return 'savings';
  if (/loan|mortgage|auto/i.test(n)) return 'loan';
  if (/brokerage|ira|401k|invest|roth/i.test(n)) return 'investment';
  return 'checking';
}

export function normalizeAccountSet(set: SFAccountSet): NormalizedAccount[] {
  return set.accounts.map((a) => ({
    externalId: a.id,
    name: a.name,
    institution: a.org?.name ?? a.org?.domain ?? '',
    balance: Number(a.balance),
    available: a['available-balance'] != null ? Number(a['available-balance']) : null,
    balanceDate: fromUnixSeconds(a['balance-date']),
    guessedType: guessAccountType(a),
    transactions: (a.transactions ?? []).map((t) => ({
      externalId: t.id,
      date: fromUnixSeconds(t.transacted_at ?? t.posted),
      amount: Number(t.amount),
      description: (t.payee || t.description || t.memo || '').trim(),
      pending: !!t.pending,
    })),
  }));
}
