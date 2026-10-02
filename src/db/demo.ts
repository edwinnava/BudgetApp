import type { SQLiteDatabase } from 'expo-sqlite';
import { addDays, addMonths, ISODate, monthKey, today } from '../lib/dates';
import { ingestTransactions, IncomingTxn } from '../sync/ingest';
import { saveCardDetails, setBudget, getCategoryIdByName } from './repo';
import { notifyChange } from './events';

/** Fills the app with ~4 months of realistic sample data so every screen can be explored. */
export async function loadDemoData(db: SQLiteDatabase): Promise<void> {
  const t = today();
  const accounts = [
    { id: 'demo:checking', name: 'Everyday Checking', institution: 'Demo Bank', type: 'checking', balance: 3240.18 },
    { id: 'demo:savings', name: 'High Yield Savings', institution: 'Demo Bank', type: 'savings', balance: 8200 },
    { id: 'demo:visa', name: 'Rewards Visa', institution: 'Demo Card Co', type: 'credit', balance: -2310.44 },
    { id: 'demo:mc', name: 'Cash Back Mastercard', institution: 'Other Card Co', type: 'credit', balance: -5120.9 },
  ] as const;
  for (const a of accounts) {
    await db.runAsync(
      `INSERT OR REPLACE INTO accounts (id, name, institution, type, balance, balance_date, source) VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
      a.id, a.name, a.institution, a.type, a.balance, t,
    );
  }
  await saveCardDetails(db, { account_id: 'demo:visa', statement_balance: 1870.25, statement_day: 3, due_day: 28, min_payment: 45, apr: 27.49, credit_limit: 8000 });
  await saveCardDetails(db, { account_id: 'demo:mc', statement_balance: 5050.1, statement_day: 18, due_day: 12, min_payment: 110, apr: 19.99, credit_limit: 12000 });

  const checking: IncomingTxn[] = [];
  const visa: IncomingTxn[] = [];
  const mc: IncomingTxn[] = [];
  let n = 0;
  const push = (list: IncomingTxn[], date: ISODate, amount: number, description: string) => {
    if (date > t) return;
    list.push({ id: `demo:${n++}`, date, amount, description, pending: false });
  };
  const start = addMonths(`${monthKey(t)}-01`, -4);

  for (let m = 0; m <= 4; m++) {
    const month = addMonths(start, m);
    const d = (day: number) => addMonths(month, 0, day);
    push(checking, d(1), -1650, 'ACH RENT PAYMENT OAKWOOD APTS');
    push(checking, d(14), -(78 + ((m * 13) % 30)), 'CITY POWER & LIGHT');
    push(checking, d(20), -65, 'XFINITY INTERNET');
    push(checking, d(22), -142.5, 'GEICO AUTO INSURANCE');
    push(visa, d(5), -15.49, 'NETFLIX.COM 866-579-7172 CA');
    push(visa, d(9), -11.99, 'SPOTIFY USA 877-778-1161 NY');
    push(mc, d(12), -45, 'PLANET FITNESS #1234');
    push(mc, d(27), -2.99, 'APPLE.COM/BILL 866-712-7753');
    push(checking, d(26), -400, 'DEMO CARD CO CREDIT CRD AUTOPAY');
    push(visa, d(26), 400, 'AUTOPAY PAYMENT - THANK YOU');
    push(checking, d(10), -350, 'CASH BACK MC CREDIT CARD PAYMENT');
    push(mc, d(10), 350, 'ONLINE PAYMENT THANK YOU');
    for (let w = 0; w < 4; w++) {
      push(visa, d(3 + w * 7), -(62 + ((m + w) * 17) % 55), w % 2 ? 'TRADER JOE S #552' : 'SAFEWAY #1820');
      push(visa, d(4 + w * 7), -(9 + ((m * 3 + w) % 12)), 'SQ *BLUE BOTTLE COFFEE');
      push(mc, d(6 + w * 7), -(18 + ((m + w * 5) % 40)), w % 2 ? 'DOORDASH*THAI KITCHEN' : 'CHIPOTLE 1123');
      push(mc, d(2 + w * 7), -(38 + (w * 7) % 20), 'SHELL OIL 57444');
    }
    push(mc, d(16), -(80 + m * 23), 'AMAZON MKTPL*2K4L1');
    push(visa, d(19), -64, 'AMC THEATRES 0412');
  }
  // Biweekly paychecks.
  for (let p = addDays(start, 4); p <= t; p = addDays(p, 14)) push(checking, p, 2450, 'ACME CORP PAYROLL DIRECT DEP');

  await ingestTransactions(db, { id: 'demo:checking', type: 'checking' }, checking);
  await ingestTransactions(db, { id: 'demo:visa', type: 'credit' }, visa);
  await ingestTransactions(db, { id: 'demo:mc', type: 'credit' }, mc);

  for (const [name, amount] of [['Groceries', 600], ['Dining', 300], ['Transportation', 200], ['Shopping', 150], ['Subscriptions', 40]] as const) {
    const id = await getCategoryIdByName(db, name);
    if (id) await setBudget(db, id, amount);
  }
  notifyChange();
}
