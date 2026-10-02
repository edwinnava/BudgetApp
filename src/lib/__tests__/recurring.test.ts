import { describe, expect, it } from 'vitest';
import { detectRecurring, nextDueDate, occurrencesBetween, monthlyEquivalent, TxnLike } from '../recurring';

const tx = (id: string, date: string, amount: number, description: string): TxnLike => ({ id, date, amount, description });

describe('nextDueDate', () => {
  it('rolls monthly bills forward keeping anchor day', () => {
    expect(nextDueDate('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28');
    expect(nextDueDate('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(nextDueDate('2026-01-15', 'monthly', '2026-10-02')).toBe('2026-10-15');
    expect(nextDueDate('2026-01-15', 'monthly', '2026-10-15')).toBe('2026-10-15');
  });
  it('walks back when anchor is in the future', () => {
    expect(nextDueDate('2026-12-15', 'monthly', '2026-10-02')).toBe('2026-10-15');
    expect(nextDueDate('2026-10-20', 'weekly', '2026-10-02')).toBe('2026-10-06');
  });
  it('handles biweekly and yearly', () => {
    expect(nextDueDate('2026-01-02', 'biweekly', '2026-01-20')).toBe('2026-01-30');
    expect(nextDueDate('2025-03-10', 'yearly', '2026-10-02')).toBe('2027-03-10');
  });
});

describe('occurrencesBetween', () => {
  it('lists dates in a range', () => {
    expect(occurrencesBetween('2026-01-05', 'weekly', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
    ]);
    expect(occurrencesBetween('2026-01-31', 'monthly', '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });
});

describe('monthlyEquivalent', () => {
  it('converts', () => {
    expect(monthlyEquivalent(120, 'yearly')).toBeCloseTo(10, 1);
    expect(monthlyEquivalent(10, 'monthly')).toBe(10);
  });
});

describe('detectRecurring', () => {
  it('finds monthly subscriptions and ignores one-offs', () => {
    const txns = [
      tx('1', '2026-07-03', -15.49, 'NETFLIX.COM 866-579-7172 CA'),
      tx('2', '2026-08-03', -15.49, 'NETFLIX.COM 866-579-7172 CA'),
      tx('3', '2026-09-03', -15.49, 'NETFLIX.COM 866-579-7172 CA'),
      tx('4', '2026-07-10', -84.12, 'CITY POWER & LIGHT'),
      tx('5', '2026-08-11', -97.4, 'CITY POWER & LIGHT'),
      tx('6', '2026-09-09', -71.02, 'CITY POWER & LIGHT'),
      tx('7', '2026-08-20', -250, 'BEST BUY #123'),
      tx('8', '2026-09-15', 2000, 'PAYROLL'),
    ];
    const found = detectRecurring(txns, { asOf: '2026-10-02' });
    expect(found.map((f) => f.name)).toEqual(['Netflix.com', 'City Power & Light']);
    expect(found[0]).toMatchObject({ frequency: 'monthly', averageAmount: 15.49, nextDate: '2026-10-03', occurrences: 3 });
    expect(found[1].frequency).toBe('monthly');
  });
  it('drops cancelled subscriptions', () => {
    const txns = [
      tx('1', '2026-03-03', -9.99, 'HULU'),
      tx('2', '2026-04-03', -9.99, 'HULU'),
      tx('3', '2026-05-03', -9.99, 'HULU'),
    ];
    expect(detectRecurring(txns, { asOf: '2026-10-02' })).toHaveLength(0);
  });
  it('requires fixed amounts for everyday spending', () => {
    const dates = ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'];
    const groceries = dates.map((d, i) => ({ ...tx(String(i), d, -(60 + i * 9), 'SAFEWAY #1820'), discretionary: true }));
    expect(detectRecurring(groceries, { asOf: '2026-10-02' })).toHaveLength(0);
    const meal = dates.map((d, i) => ({ ...tx(String(i), d, -59.99, 'MEAL KIT CO'), discretionary: true }));
    expect(detectRecurring(meal, { asOf: '2026-10-02' })).toHaveLength(1);
  });
  it('detects weekly and needs 3 occurrences', () => {
    const weekly = ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'].map((d, i) => tx(String(i), d, -30, 'CLEANING SERVICE'));
    expect(detectRecurring(weekly, { asOf: '2026-10-02' })[0].frequency).toBe('weekly');
    expect(detectRecurring(weekly.slice(2), { asOf: '2026-10-02' })).toHaveLength(0);
  });
});
