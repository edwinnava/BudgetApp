/**
 * Credit card debt payoff planning: monthly allocation and full payoff simulation.
 */

export type Strategy = 'avalanche' | 'snowball';

export const STRATEGY_INFO: Record<Strategy, { label: string; description: string }> = {
  avalanche: {
    label: 'Avalanche',
    description: 'Extra money goes to the highest APR first. Saves the most on interest.',
  },
  snowball: {
    label: 'Snowball',
    description: 'Extra money goes to the smallest balance first. Pays off cards quicker for motivation.',
  },
};

export interface DebtCard {
  id: string;
  name: string;
  balance: number; // amount owed, >= 0
  apr: number; // percent, e.g. 24.99
  minPayment?: number | null; // from the statement; estimated if missing
}

export interface Allocation {
  id: string;
  name: string;
  minimum: number;
  extra: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Typical issuer formula: 1% of balance + this month's interest, at least $25 (or the balance if smaller). */
export function estimateMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const est = balance * 0.01 + (balance * apr) / 1200;
  return r2(Math.min(balance, Math.max(25, est)));
}

export function minimumFor(card: DebtCard): number {
  if (card.balance <= 0) return 0;
  const min = card.minPayment != null && card.minPayment > 0 ? card.minPayment : estimateMinPayment(card.balance, card.apr);
  return r2(Math.min(card.balance, min));
}

export function orderForStrategy<T extends DebtCard>(cards: T[], strategy: Strategy): T[] {
  return [...cards].sort((a, b) =>
    strategy === 'avalanche'
      ? b.apr - a.apr || a.balance - b.balance
      : a.balance - b.balance || b.apr - a.apr,
  );
}

/**
 * Splits a monthly payment budget across cards: every card gets its minimum, then the
 * remainder goes to cards in strategy order until each is paid off.
 */
export function allocatePayments(cards: DebtCard[], budget: number, strategy: Strategy): {
  allocations: Allocation[];
  totalMinimum: number;
  shortfall: number; // > 0 when the budget does not cover minimums
  leftover: number; // budget not needed because all debt is covered
} {
  const active = cards.filter((c) => c.balance > 0);
  const mins = new Map(active.map((c) => [c.id, minimumFor(c)]));
  const totalMinimum = r2([...mins.values()].reduce((a, b) => a + b, 0));
  const alloc = new Map<string, Allocation>(
    active.map((c) => [c.id, { id: c.id, name: c.name, minimum: mins.get(c.id)!, extra: 0, total: 0 }]),
  );

  let remaining = budget;
  if (budget < totalMinimum) {
    // Not enough for minimums: cover them in strategy order so the most expensive debt is protected first.
    for (const c of orderForStrategy(active, strategy)) {
      const a = alloc.get(c.id)!;
      const pay = Math.min(a.minimum, remaining);
      a.minimum = r2(pay);
      remaining -= pay;
    }
    remaining = 0;
  } else {
    remaining -= totalMinimum;
    for (const c of orderForStrategy(active, strategy)) {
      if (remaining <= 0.004) break;
      const a = alloc.get(c.id)!;
      const room = c.balance - a.minimum;
      const pay = Math.min(room, remaining);
      a.extra = r2(pay);
      remaining -= pay;
    }
  }
  const allocations = active.map((c) => {
    const a = alloc.get(c.id)!;
    a.total = r2(a.minimum + a.extra);
    return a;
  });
  return {
    allocations,
    totalMinimum,
    shortfall: r2(Math.max(0, totalMinimum - budget)),
    leftover: r2(Math.max(0, remaining)),
  };
}

export interface PayoffMonth {
  month: number; // 1-based
  interest: number;
  paid: number;
  remaining: number;
}

export interface PayoffResult {
  feasible: boolean; // false if debt never reaches zero within maxMonths
  months: number;
  totalInterest: number;
  totalPaid: number;
  payoffMonthByCard: Record<string, number>;
  schedule: PayoffMonth[];
}

/**
 * Simulates paying a fixed amount every month. Interest accrues monthly (APR / 12) before payment.
 * Minimums are recalculated from each card's current balance; money freed by a paid-off
 * card rolls into the next card in strategy order.
 */
export function simulatePayoff(
  cards: DebtCard[],
  monthlyBudget: number,
  strategy: Strategy,
  maxMonths = 600,
): PayoffResult {
  const state = cards.filter((c) => c.balance > 0).map((c) => ({ ...c }));
  // A statement minimum is a snapshot; scale it as a fraction of balance while simulating.
  const minRatio = new Map(
    state.map((c) => [c.id, c.minPayment && c.balance > 0 ? c.minPayment / c.balance : null]),
  );
  const payoffMonthByCard: Record<string, number> = {};
  const schedule: PayoffMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= maxMonths; month++) {
    const open = state.filter((c) => c.balance > 0.004);
    if (open.length === 0) break;
    let interest = 0;
    for (const c of open) {
      const i = (c.balance * c.apr) / 1200;
      c.balance += i;
      interest += i;
    }
    const withMins = open.map((c) => {
      const ratio = minRatio.get(c.id);
      const min = ratio != null ? Math.max(25, c.balance * ratio) : estimateMinPayment(c.balance, c.apr);
      return { ...c, minPayment: Math.min(c.balance, min) };
    });
    const { allocations } = allocatePayments(withMins, monthlyBudget, strategy);
    let paid = 0;
    for (const a of allocations) {
      const c = state.find((s) => s.id === a.id)!;
      c.balance -= a.total;
      if (c.balance < 0.01) c.balance = 0; // cent rounding residue
      paid += a.total;
      if (c.balance === 0 && payoffMonthByCard[c.id] == null) payoffMonthByCard[c.id] = month;
    }
    totalInterest += interest;
    totalPaid += paid;
    const remaining = state.reduce((s, c) => s + c.balance, 0);
    schedule.push({ month, interest: r2(interest), paid: r2(paid), remaining: r2(remaining) });
    // Bail out early when payments do not even cover interest.
    if (month > 12 && remaining >= schedule[month - 13].remaining) {
      return { feasible: false, months: month, totalInterest: r2(totalInterest), totalPaid: r2(totalPaid), payoffMonthByCard, schedule };
    }
  }
  const feasible = state.every((c) => c.balance <= 0.004);
  return {
    feasible,
    months: schedule.length,
    totalInterest: r2(totalInterest),
    totalPaid: r2(totalPaid),
    payoffMonthByCard,
    schedule,
  };
}

/** Avoiding interest: paying the full statement balance by the due date keeps the grace period. */
export function interestIfCarried(balance: number, apr: number): number {
  return r2((balance * apr) / 1200);
}
