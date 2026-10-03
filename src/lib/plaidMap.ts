/**
 * Converts the worker's Plaid sync payload into the app's conventions.
 * Types mirror server/src/handler.ts (kept separate so the app doesn't import server code).
 */
import { CARD_PAYMENT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY } from './categorize';
import { parseISO } from './dates';

export interface PlaidAccount {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current: number | null;
  available: number | null;
  limit: number | null;
}

export interface PlaidTransaction {
  id: string;
  accountId: string;
  amount: number;
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  pending: boolean;
  pendingTransactionId: string | null;
  category: string | null;
  detailedCategory: string | null;
}

export interface PlaidCardLiability {
  accountId: string;
  lastStatementBalance: number | null;
  lastStatementIssueDate: string | null;
  minimumPaymentAmount: number | null;
  nextPaymentDueDate: string | null;
  purchaseApr: number | null;
}

export interface PlaidSyncResponse {
  accounts: PlaidAccount[];
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  nextCursor: string;
  liabilities: PlaidCardLiability[] | null;
}

export type AppAccountType = 'checking' | 'savings' | 'credit' | 'loan' | 'investment';

export const plaidAccountId = (id: string) => `plaid:${id}`;
export const plaidTxnId = (id: string) => `plaid:${id}`;

export function mapAccountType(type: string, subtype: string | null): AppAccountType {
  if (type === 'credit') return 'credit';
  if (type === 'loan') return 'loan';
  if (type === 'investment' || type === 'brokerage') return 'investment';
  if (subtype && /savings|money market|cd|hsa/i.test(subtype)) return 'savings';
  return 'checking';
}

/** App convention: money owed on cards/loans is stored as a negative balance. Plaid reports it positive. */
export function accountBalance(a: PlaidAccount): number {
  const current = a.current ?? a.available ?? 0;
  const t = mapAccountType(a.type, a.subtype);
  return t === 'credit' || t === 'loan' ? -current : current;
}

export function accountName(a: PlaidAccount): string {
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

/** Maps Plaid's personal finance category to one of the app's default categories. */
export function plaidCategoryName(
  primary: string | null,
  detailed: string | null,
  amount: number, // app convention: negative = money out
  accountType: AppAccountType,
): string | null {
  if (!primary) return null;
  const d = detailed ?? '';
  if (d === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return CARD_PAYMENT_CATEGORY;
  // A credit arriving on a card that Plaid calls a transfer is almost always the bill payment.
  if (accountType === 'credit' && amount > 0 && primary === 'TRANSFER_IN') return CARD_PAYMENT_CATEGORY;
  switch (primary) {
    case 'INCOME':
      return INCOME_CATEGORY;
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':
      return TRANSFER_CATEGORY;
    case 'LOAN_PAYMENTS':
      return d === 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' ? 'Housing' : 'Bills & Utilities';
    case 'BANK_FEES':
      return 'Fees & Interest';
    case 'ENTERTAINMENT':
      return 'Entertainment';
    case 'FOOD_AND_DRINK':
      return d === 'FOOD_AND_DRINK_GROCERIES' ? 'Groceries' : 'Dining';
    case 'GENERAL_MERCHANDISE':
    case 'HOME_IMPROVEMENT':
      return 'Shopping';
    case 'MEDICAL':
      return 'Health';
    case 'PERSONAL_CARE':
      return d === 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS' ? 'Health' : 'Personal Care';
    case 'GENERAL_SERVICES':
      return d === 'GENERAL_SERVICES_INSURANCE' ? 'Insurance' : 'Other';
    case 'TRANSPORTATION':
      return 'Transportation';
    case 'TRAVEL':
      return 'Travel';
    case 'RENT_AND_UTILITIES':
      return d === 'RENT_AND_UTILITIES_RENT' ? 'Housing' : 'Bills & Utilities';
    case 'GOVERNMENT_AND_NON_PROFIT':
      return 'Other';
    default:
      return null;
  }
}

export interface MappedTxn {
  id: string;
  date: string;
  amount: number;
  description: string;
  pending: boolean;
  hint: string | null;
  inheritFrom: string | null;
}

export function mapTransaction(t: PlaidTransaction, accountType: AppAccountType): MappedTxn {
  const amount = -t.amount;
  return {
    id: plaidTxnId(t.id),
    date: t.authorizedDate ?? t.date,
    amount,
    description: (t.merchantName || t.name).trim(),
    pending: t.pending,
    hint: plaidCategoryName(t.category, t.detailedCategory, amount, accountType),
    inheritFrom: t.pendingTransactionId ? plaidTxnId(t.pendingTransactionId) : null,
  };
}

export interface CardDetailsPatch {
  statement_balance?: number;
  statement_day?: number;
  due_day?: number;
  min_payment?: number;
  apr?: number;
  credit_limit?: number;
}

const dayOf = (iso: string) => parseISO(iso).getDate();

/** Only fields Plaid actually provided, so values the user typed in aren't wiped by nulls. */
export function cardDetailsFromPlaid(account: PlaidAccount, l: PlaidCardLiability | undefined): CardDetailsPatch {
  const p: CardDetailsPatch = {};
  if (account.limit != null) p.credit_limit = account.limit;
  if (!l) return p;
  if (l.lastStatementBalance != null) p.statement_balance = l.lastStatementBalance;
  if (l.lastStatementIssueDate) p.statement_day = dayOf(l.lastStatementIssueDate);
  if (l.nextPaymentDueDate) p.due_day = dayOf(l.nextPaymentDueDate);
  if (l.minimumPaymentAmount != null) p.min_payment = l.minimumPaymentAmount;
  if (l.purchaseApr != null) p.apr = l.purchaseApr;
  return p;
}
