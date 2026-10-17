import { describe, expect, it } from 'vitest';
import {
  allocate, clampPayment, daysUntilDue, planPayday, redistribute, summarize, trackerStats, urgencyFor, PaydayCard, PaydaySnapshot,
} from '../payday';

const cards: PaydayCard[] = [
  { id: 'a', name: 'Sapphire', min: 40, dueDay: 21, apr: 21.49, balance: 500 },
  { id: 'b', name: 'Venture X', min: 39, dueDay: 13, apr: 28.24, balance: 300 },
  { id: 'c', name: 'Discover', min: 35, dueDay: 7, apr: 20.49, balance: 100 },
  { id: 'd', name: 'Paid off', min: 25, dueDay: 1, apr: 30, balance: 0 },
];

describe('payday', () => {
  it('computes days until due and urgency', () => {
    expect(daysUntilDue(7, '2026-10-03')).toBe(4);
    expect(daysUntilDue(3, '2026-10-03')).toBe(0);
    expect(daysUntilDue(1, '2026-10-03')).toBe(29);
    expect(daysUntilDue(null, '2026-10-03')).toBeNull();
    expect(urgencyFor(4)).toBe('urgent');
    expect(urgencyFor(10)).toBe('soon');
    expect(urgencyFor(20)).toBe('later');
    expect(urgencyFor(null)).toBe('none');
  });

  it('pays minimums then cascades soonest-due first', () => {
    const plan = planPayday(cards, 400, 'due', '2026-10-03');
    expect(plan.map((p) => [p.id, p.payment])).toEqual([
      ['c', 100], // due in 4 days: paid off
      ['b', 260], // due in 10 days: min + the rest
      ['a', 40], // just the minimum
    ]);
    expect(summarize(plan, 400)).toEqual({ totalPaying: 400, leftover: 0 });
  });

  it('cascades highest APR first in apr mode', () => {
    const plan = planPayday(cards, 400, 'apr', '2026-10-03');
    expect(plan.map((p) => [p.id, p.payment])).toEqual([
      ['b', 300],
      ['a', 65],
      ['c', 35],
    ]);
  });

  it('protects the highest-priority minimums when the pool is short', () => {
    expect(allocate(50, [{ min: 35, balance: 100 }, { min: 40, balance: 500 }]).map((p) => p.payment)).toEqual([35, 15]);
    expect(allocate(-20, [{ min: 35, balance: 100 }]).map((p) => p.payment)).toEqual([0]);
  });

  it('leaves leftover when the pool exceeds all balances', () => {
    const plan = planPayday(cards, 2000, 'due', '2026-10-03');
    expect(summarize(plan, 2000).leftover).toBe(1100);
  });

  it('keeps locked payments and re-spreads the rest', () => {
    const plan = planPayday(cards, 400, 'due', '2026-10-03');
    const edited = plan.map((p) => (p.id === 'b' ? { ...p, payment: 100 } : p));
    const out = redistribute(edited, new Set(['b']), 400, 'due');
    expect(out.map((p) => [p.id, p.payment])).toEqual([
      ['c', 100],
      ['b', 100],
      ['a', 200],
    ]);
  });

  it('clamps typed payments', () => {
    expect(clampPayment(999, 300)).toBe(300);
    expect(clampPayment(-5, 300)).toBe(0);
    expect(clampPayment(NaN, 300)).toBe(0);
    expect(clampPayment(12.345, 300)).toBe(12.35);
  });

  it('builds tracker stats from history (newest first)', () => {
    const history: PaydaySnapshot[] = [
      {
        date: '2026-10-17', createdAt: 2, paycheck: 2000, totalBills: 1000,
        cards: [{ id: 'a', name: 'Sapphire', apr: 21, balance: 800, payment: 300, newBalance: 500, currentBalance: 520 }],
      },
      {
        date: '2026-10-03', createdAt: 1, paycheck: 2000, totalBills: 1000,
        cards: [{ id: 'a', name: 'Sapphire', apr: 21, balance: 1000, payment: 200, newBalance: 800, currentBalance: null }],
      },
    ];
    const s = trackerStats(history)!;
    expect(s.totalDebtNow).toBe(500);
    expect(s.totalPaidEver).toBe(500);
    expect(s.changeSinceStart).toBe(-500);
    expect(s.changeSinceLast).toBe(-300);
    expect(s.cards[0]).toMatchObject({ balance: 520, change: -280, totalPaid: 500, pctPaid: 50 });
    expect(trackerStats([])).toBeNull();
  });
});
