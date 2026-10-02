import { addMonths, ISODate, monthKey, nextDayOfMonth, today, parseISO } from './dates';
import type { DebtCard } from './payoff';

export const ASSUMED_APR = 24;

/** Most recent date on or before `asOf` that falls on `day` (clamped to month length). */
export function lastDayOfMonthOnOrBefore(day: number, asOf: ISODate = today()): ISODate {
  const monthStart = `${monthKey(asOf)}-01`;
  const thisMonth = addMonths(monthStart, 0, day);
  return thisMonth <= asOf ? thisMonth : addMonths(monthStart, -1, day);
}

/** Start of the current billing cycle: the last statement close, or the 1st of the month. */
export function cycleStart(statementDay: number | null, asOf: ISODate = today()): ISODate {
  return statementDay ? lastDayOfMonthOnOrBefore(statementDay, asOf) : `${monthKey(asOf)}-01`;
}

export function nextDue(dueDay: number | null, asOf: ISODate = today()): ISODate | null {
  return dueDay ? nextDayOfMonth(dueDay, asOf) : null;
}

export function daysUntil(date: ISODate, asOf: ISODate = today()): number {
  return Math.round((parseISO(date).getTime() - parseISO(asOf).getTime()) / 86_400_000);
}

export function utilization(owed: number, limit: number | null): number | null {
  return limit && limit > 0 ? owed / limit : null;
}

export function toDebtCard(c: { id: string; name: string; owed: number; apr: number | null; min_payment: number | null }): DebtCard {
  return { id: c.id, name: c.name, balance: c.owed, apr: c.apr ?? ASSUMED_APR, minPayment: c.min_payment };
}

