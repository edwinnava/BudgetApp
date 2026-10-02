import { addDays, ISODate, today } from './dates';
import { Frequency, occurrencesBetween } from './recurring';

export interface BillLike {
  id: number;
  name: string;
  amount: number;
  frequency: Frequency;
  anchor_date: ISODate;
  active: number;
}

export interface UpcomingBill<T extends BillLike> {
  bill: T;
  date: ISODate;
}

/** Due dates of active bills in the next `days` days, soonest first. */
export function upcomingBills<T extends BillLike>(bills: T[], days: number, from: ISODate = today()): UpcomingBill<T>[] {
  const end = addDays(from, days);
  return bills
    .filter((b) => b.active)
    .flatMap((bill) => occurrencesBetween(bill.anchor_date, bill.frequency, from, end).map((date) => ({ bill, date })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.bill.amount - a.bill.amount));
}
