import { addDays, addMonths, daysBetween, ISODate, parseISO, today } from './dates';
import { normalizeMerchant, displayMerchant } from './categorize';

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export const FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const PERIOD_DAYS: Record<Frequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  yearly: 365.25,
};

/** Allowed interval range (in days) for classifying a gap as a given frequency. */
const INTERVAL_RANGES: [Frequency, number, number][] = [
  ['weekly', 6, 8],
  ['biweekly', 12, 16],
  ['monthly', 26, 35],
  ['quarterly', 84, 98],
  ['yearly', 350, 380],
];

export function advance(date: ISODate, freq: Frequency, n = 1, anchorDay?: number): ISODate {
  switch (freq) {
    case 'weekly':
      return addDays(date, 7 * n);
    case 'biweekly':
      return addDays(date, 14 * n);
    case 'monthly':
      return addMonths(date, n, anchorDay);
    case 'quarterly':
      return addMonths(date, 3 * n, anchorDay);
    case 'yearly':
      return addMonths(date, 12 * n, anchorDay);
  }
}

export function monthlyEquivalent(amount: number, freq: Frequency): number {
  return (amount * 30.44) / PERIOD_DAYS[freq];
}

/**
 * Given a bill's anchor (any known due date), returns the first due date on or after `asOf`.
 * Monthly-style bills keep the anchor's day of month so Jan 31 -> Feb 28 -> Mar 31.
 */
export function nextDueDate(anchor: ISODate, freq: Frequency, asOf: ISODate = today()): ISODate {
  const anchorDay = parseISO(anchor).getDate();
  if (anchor >= asOf) {
    // Walk backwards while the previous occurrence is still on/after asOf.
    let d = anchor;
    for (let n = 1; n < 1000; n++) {
      const prev = advance(anchor, freq, -n, anchorDay);
      if (prev < asOf) break;
      d = prev;
    }
    return d;
  }
  // Jump close to the target, then step forward.
  const approx = Math.max(0, Math.floor(daysBetween(anchor, asOf) / PERIOD_DAYS[freq]) - 1);
  let n = approx;
  let d = advance(anchor, freq, n, anchorDay);
  while (d < asOf) d = advance(anchor, freq, ++n, anchorDay);
  return d;
}

/** All due dates of a bill in [start, end]. */
export function occurrencesBetween(anchor: ISODate, freq: Frequency, start: ISODate, end: ISODate): ISODate[] {
  const anchorDay = parseISO(anchor).getDate();
  const first = nextDueDate(anchor, freq, start);
  const out: ISODate[] = [];
  // Re-derive each date from the anchor to avoid day-of-month drift.
  const baseOffset = countOccurrences(anchor, freq, first, anchorDay);
  for (let i = 0; i < 500; i++) {
    const d = advance(anchor, freq, baseOffset + i, anchorDay);
    if (d > end) break;
    if (d >= start) out.push(d);
  }
  return out;
}

function countOccurrences(anchor: ISODate, freq: Frequency, target: ISODate, anchorDay: number): number {
  const approx = Math.round(daysBetween(anchor, target) / PERIOD_DAYS[freq]);
  for (const n of [approx, approx - 1, approx + 1, approx - 2, approx + 2]) {
    if (advance(anchor, freq, n, anchorDay) === target) return n;
  }
  return approx;
}

export interface TxnLike {
  id: string;
  date: ISODate;
  amount: number; // negative = money out
  description: string;
  /** Everyday spending (groceries, dining, gas…) only counts as recurring with a near-fixed amount. */
  discretionary?: boolean;
}

export interface RecurringCandidate {
  merchantKey: string;
  name: string;
  frequency: Frequency;
  averageAmount: number; // positive
  lastAmount: number; // positive
  lastDate: ISODate;
  nextDate: ISODate;
  occurrences: number;
  transactionIds: string[];
  confidence: number; // 0..1
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function classify(interval: number): Frequency | null {
  for (const [f, lo, hi] of INTERVAL_RANGES) if (interval >= lo && interval <= hi) return f;
  return null;
}

/**
 * Finds charges that repeat on a regular schedule (subscriptions, bills).
 * Groups outflows by normalized merchant, then looks for a consistent interval.
 */
export function detectRecurring(
  txns: TxnLike[],
  opts: { asOf?: ISODate; minConfidence?: number } = {},
): RecurringCandidate[] {
  const asOf = opts.asOf ?? today();
  const minConfidence = opts.minConfidence ?? 0.5;
  const groups = new Map<string, TxnLike[]>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const key = normalizeMerchant(t.description);
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, group] of groups) {
    // One charge per day; keep the largest if a merchant charged twice on the same day.
    const byDay = new Map<string, TxnLike>();
    for (const t of group) {
      const prev = byDay.get(t.date);
      if (!prev || Math.abs(t.amount) > Math.abs(prev.amount)) byDay.set(t.date, t);
    }
    const items = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (items.length < 2) continue;

    const intervals = items.slice(1).map((t, i) => daysBetween(items[i].date, t.date));
    const freq = classify(median(intervals));
    if (!freq) continue;
    const minCount = freq === 'weekly' || freq === 'biweekly' ? 3 : 2;
    if (items.length < minCount) continue;

    const [, lo, hi] = INTERVAL_RANGES.find(([f]) => f === freq)!;
    const regular = intervals.filter((d) => d >= lo && d <= hi).length / intervals.length;

    const amounts = items.map((t) => Math.abs(t.amount));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - avg) ** 2, 0) / amounts.length);
    const cv = avg > 0 ? sd / avg : 1;
    if (cv > 0.5) continue;
    const discretionary = items.filter((t) => t.discretionary).length > items.length / 2;
    if (discretionary && cv > 0.05) continue;

    const last = items[items.length - 1];
    const nextDate = nextDueDate(last.date, freq, addDays(last.date, 1));
    // Stale: the next charge is long overdue, so it was probably cancelled.
    const overdue = daysBetween(nextDate, asOf);
    if (overdue > PERIOD_DAYS[freq] * 0.5 + 5) continue;

    const countScore = Math.min(1, items.length / (minCount + 2));
    const amountScore = cv < 0.02 ? 1 : cv < 0.15 ? 0.8 : 0.5;
    const confidence = Math.round(regular * (0.5 + 0.25 * countScore + 0.25 * amountScore) * 100) / 100;
    if (confidence < minConfidence) continue;

    out.push({
      merchantKey: key,
      name: displayMerchant(key),
      frequency: freq,
      averageAmount: Math.round(avg * 100) / 100,
      lastAmount: Math.abs(last.amount),
      lastDate: last.date,
      nextDate: nextDueDate(last.date, freq, asOf),
      occurrences: items.length,
      transactionIds: items.map((t) => t.id),
      confidence,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.averageAmount - a.averageAmount);
}
