/** Dates are stored as local calendar dates in `YYYY-MM-DD` form. */
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

export function today(): ISODate {
  return toISO(new Date());
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s: ISODate, n: number, anchorDay?: number): ISODate {
  const d = parseISO(s);
  const day = anchorDay ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const clamped = Math.min(day, daysInMonth(target.getFullYear(), target.getMonth()));
  return toISO(new Date(target.getFullYear(), target.getMonth(), clamped));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** `YYYY-MM` */
export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function monthRange(key: string): { start: ISODate; end: ISODate } {
  const [y, m] = key.split('-').map(Number);
  return { start: `${key}-01`, end: `${key}-${pad(daysInMonth(y, m - 1))}` };
}

export function shiftMonth(key: string, n: number): string {
  return monthKey(addMonths(`${key}-01`, n));
}

/** Next date on or after `from` that falls on `day` of the month (clamped to month length). */
export function nextDayOfMonth(day: number, from: ISODate = today()): ISODate {
  const f = parseISO(from);
  const thisMonth = toISO(
    new Date(f.getFullYear(), f.getMonth(), Math.min(day, daysInMonth(f.getFullYear(), f.getMonth()))),
  );
  return thisMonth >= from ? thisMonth : addMonths(`${monthKey(from)}-01`, 1, day);
}

export function formatDate(s: ISODate, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return parseISO(s).toLocaleDateString(undefined, opts);
}

export function formatMonth(key: string): string {
  return parseISO(`${key}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function fromUnixSeconds(sec: number): ISODate {
  return toISO(new Date(sec * 1000));
}
