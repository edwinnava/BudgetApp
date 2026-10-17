/**
 * Payday optimizer: splits what's left of a paycheck after bills across credit cards.
 * Every card gets its minimum, then the rest cascades in priority order (soonest due or
 * highest APR). Payments the user edits are "locked"; the remaining budget is re-spread
 * over the unlocked cards.
 */
import { daysBetween, ISODate, nextDayOfMonth } from './dates';

export type PaydayMode = 'due' | 'apr';

export interface PaydayCard {
  id: string;
  name: string;
  min: number;
  dueDay: number | null;
  apr: number;
  balance: number; // statement balance to pay toward
}

export interface PaydayPayment extends PaydayCard {
  daysUntil: number | null;
  payment: number;
}

export type Urgency = 'urgent' | 'soon' | 'later' | 'none';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Days from `from` until the card's next due date. A due date of today counts as today (0 days). */
export function daysUntilDue(dueDay: number | null, from: ISODate): number | null {
  if (!dueDay) return null;
  return daysBetween(from, nextDayOfMonth(dueDay, from));
}

export function urgencyFor(daysUntil: number | null): Urgency {
  if (daysUntil == null) return 'none';
  if (daysUntil <= 7) return 'urgent';
  if (daysUntil <= 14) return 'soon';
  return 'later';
}

export function sortForMode<T extends { apr: number; daysUntil: number | null; balance: number }>(cards: T[], mode: PaydayMode): T[] {
  const far = Number.MAX_SAFE_INTEGER;
  return [...cards].sort((a, b) =>
    mode === 'apr'
      ? b.apr - a.apr || (a.daysUntil ?? far) - (b.daysUntil ?? far)
      : (a.daysUntil ?? far) - (b.daysUntil ?? far) || b.apr - a.apr,
  );
}

/** Minimums first (in priority order if the pool can't cover them all), then cascade the rest. */
export function allocate<T extends { min: number; balance: number }>(pool: number, ordered: T[]): (T & { payment: number })[] {
  let remaining = r2(Math.max(0, pool));
  const pays = ordered.map((c) => {
    const min = Math.min(c.min, c.balance);
    const payment = r2(Math.min(min, remaining));
    remaining = r2(remaining - payment);
    return { ...c, payment };
  });
  for (const p of pays) {
    if (remaining <= 0) break;
    const extra = r2(Math.min(remaining, p.balance - p.payment));
    p.payment = r2(p.payment + extra);
    remaining = r2(remaining - extra);
  }
  return pays;
}

export function planPayday(cards: PaydayCard[], pool: number, mode: PaydayMode, from: ISODate): PaydayPayment[] {
  const active = cards
    .filter((c) => c.balance > 0)
    .map((c) => ({ ...c, daysUntil: daysUntilDue(c.dueDay, from) }));
  return allocate(pool, sortForMode(active, mode));
}

/**
 * Keeps locked payments as they are and re-spreads the rest of the pool over the unlocked
 * cards in mode order. Order of the returned list is preserved.
 */
export function redistribute(payments: PaydayPayment[], locked: Set<string>, pool: number, mode: PaydayMode): PaydayPayment[] {
  const lockedTotal = payments.filter((p) => locked.has(p.id)).reduce((s, p) => s + p.payment, 0);
  const unlocked = sortForMode(payments.filter((p) => !locked.has(p.id)), mode);
  const recalculated = new Map(allocate(pool - lockedTotal, unlocked).map((p) => [p.id, p.payment]));
  return payments.map((p) => (locked.has(p.id) ? p : { ...p, payment: recalculated.get(p.id) ?? 0 }));
}

/** Clamp a user-typed payment to [0, balance]. */
export function clampPayment(value: number, balance: number): number {
  return r2(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), balance));
}

export interface PaydaySummary {
  totalPaying: number;
  leftover: number;
}

export function summarize(payments: PaydayPayment[], pool: number): PaydaySummary {
  const totalPaying = r2(payments.reduce((s, p) => s + p.payment, 0));
  return { totalPaying, leftover: r2(pool - totalPaying) };
}

// ---------- snapshots / tracker ----------

export interface SnapshotCard {
  id: string;
  name: string;
  apr: number;
  balance: number;
  payment: number;
  newBalance: number;
  currentBalance: number | null;
}

export interface PaydaySnapshot {
  id?: number;
  date: ISODate;
  createdAt: number;
  paycheck: number;
  totalBills: number;
  cards: SnapshotCard[];
}

export function snapshotCards(payments: PaydayPayment[], current: Map<string, number | null>): SnapshotCard[] {
  return payments.map((p) => ({
    id: p.id,
    name: p.name,
    apr: p.apr,
    balance: p.balance,
    payment: p.payment,
    newBalance: r2(Math.max(0, p.balance - p.payment)),
    currentBalance: current.get(p.id) ?? null,
  }));
}

const trackedBalance = (c: SnapshotCard) => (c.currentBalance != null ? c.currentBalance : c.newBalance);

export interface TrackerStats {
  totalDebtNow: number;
  totalPaidEver: number;
  changeSinceStart: number;
  changeSinceLast: number | null;
  cards: {
    id: string;
    name: string;
    apr: number;
    balance: number;
    change: number | null;
    totalPaid: number;
    pctPaid: number;
  }[];
}

/** `history` is newest first. Cards are matched by id (falling back to name for older entries). */
export function trackerStats(history: PaydaySnapshot[]): TrackerStats | null {
  if (!history.length) return null;
  const [latest, prev] = history;
  const oldest = history[history.length - 1];
  const sameCard = (a: SnapshotCard, b: SnapshotCard) => a.id === b.id || a.name === b.name;
  const totalDebtNow = r2(latest.cards.reduce((s, c) => s + c.newBalance, 0));
  const totalDebtStart = r2(oldest.cards.reduce((s, c) => s + c.balance, 0));
  const totalPaidEver = r2(history.reduce((s, h) => s + h.cards.reduce((t, c) => t + c.payment, 0), 0));
  const totalDebtPrev = prev ? r2(prev.cards.reduce((s, c) => s + c.newBalance, 0)) : null;

  const cards = latest.cards.map((c) => {
    const entries = history.flatMap((h) => h.cards.filter((x) => sameCard(x, c)));
    const totalPaid = r2(entries.reduce((s, x) => s + x.payment, 0));
    const firstBalance = entries[entries.length - 1]?.balance ?? c.balance;
    const prevCard = prev?.cards.find((x) => sameCard(x, c));
    const balance = trackedBalance(c);
    return {
      id: c.id,
      name: c.name,
      apr: c.apr,
      balance,
      change: prevCard ? r2(balance - trackedBalance(prevCard)) : null,
      totalPaid,
      pctPaid: firstBalance > 0 ? Math.min(100, Math.round((totalPaid / firstBalance) * 100)) : 0,
    };
  });

  return {
    totalDebtNow,
    totalPaidEver,
    changeSinceStart: r2(totalDebtNow - totalDebtStart),
    changeSinceLast: totalDebtPrev == null ? null : r2(totalDebtNow - totalDebtPrev),
    cards,
  };
}
