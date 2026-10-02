export function formatMoney(amount: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const { cents = true, sign = false } = opts;
  const abs = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  const prefix = amount < 0 ? '-' : sign && amount > 0 ? '+' : '';
  return `${prefix}$${abs}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parses user/CSV input like "$1,234.56", "-12", "(45.00)". Returns null if not a number. */
export function parseAmount(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}
