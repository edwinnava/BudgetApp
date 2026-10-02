import { describe, expect, it } from 'vitest';
import { allocatePayments, estimateMinPayment, simulatePayoff, DebtCard } from '../payoff';

const cards: DebtCard[] = [
  { id: 'a', name: 'Low APR big', balance: 5000, apr: 12, minPayment: 100 },
  { id: 'b', name: 'High APR', balance: 3000, apr: 27, minPayment: 90 },
  { id: 'c', name: 'Small', balance: 400, apr: 20, minPayment: 25 },
];

describe('estimateMinPayment', () => {
  it('uses 1% + interest with a $25 floor', () => {
    expect(estimateMinPayment(1000, 24)).toBe(30);
    expect(estimateMinPayment(500, 10)).toBe(25);
    expect(estimateMinPayment(10, 20)).toBe(10);
  });
});

describe('allocatePayments', () => {
  it('avalanche sends extra to the highest APR', () => {
    const { allocations, totalMinimum, shortfall } = allocatePayments(cards, 600, 'avalanche');
    expect(totalMinimum).toBe(215);
    expect(shortfall).toBe(0);
    const b = allocations.find((x) => x.id === 'b')!;
    expect(b.extra).toBe(385);
    expect(allocations.reduce((s, a) => s + a.total, 0)).toBeCloseTo(600);
  });
  it('snowball sends extra to the smallest balance and spills over', () => {
    const { allocations } = allocatePayments(cards, 600, 'snowball');
    const c = allocations.find((x) => x.id === 'c')!;
    expect(c.total).toBe(400);
    expect(allocations.find((x) => x.id === 'b')!.extra).toBe(10);
  });
  it('reports a shortfall', () => {
    const r = allocatePayments(cards, 150, 'avalanche');
    expect(r.shortfall).toBe(65);
    expect(r.allocations.find((x) => x.id === 'b')!.total).toBe(90);
  });
  it('leaves leftover when budget exceeds debt', () => {
    expect(allocatePayments([{ id: 'x', name: 'x', balance: 100, apr: 20 }], 300, 'avalanche').leftover).toBe(200);
  });
});

describe('simulatePayoff', () => {
  it('avalanche costs less interest than snowball', () => {
    const av = simulatePayoff(cards, 600, 'avalanche');
    const sb = simulatePayoff(cards, 600, 'snowball');
    expect(av.feasible).toBe(true);
    expect(av.totalInterest).toBeLessThan(sb.totalInterest);
    expect(av.months).toBeGreaterThan(12);
    expect(av.months).toBeLessThan(24);
    expect(sb.payoffMonthByCard.c).toBe(1);
  });
  it('flags budgets that never pay off', () => {
    const r = simulatePayoff([{ id: 'x', name: 'x', balance: 10000, apr: 30, minPayment: 50 }], 200, 'avalanche');
    expect(r.feasible).toBe(false);
  });
  it('matches a simple amortization', () => {
    // $1000 at 12% APR paying $100/mo -> 11 months, ~$58 interest.
    const r = simulatePayoff([{ id: 'x', name: 'x', balance: 1000, apr: 12 }], 100, 'avalanche');
    expect(r.months).toBe(11);
    expect(r.totalInterest).toBeGreaterThan(55);
    expect(r.totalInterest).toBeLessThan(60);
  });
});
