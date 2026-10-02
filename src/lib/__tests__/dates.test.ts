import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, monthRange, nextDayOfMonth, shiftMonth, isValidISO } from '../dates';

describe('dates', () => {
  it('clamps month-end dates', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
  it('computes ranges and diffs', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // across DST
  });
  it('finds next day of month', () => {
    expect(nextDayOfMonth(15, '2026-10-02')).toBe('2026-10-15');
    expect(nextDayOfMonth(1, '2026-10-02')).toBe('2026-11-01');
    expect(nextDayOfMonth(31, '2026-11-05')).toBe('2026-11-30');
    expect(nextDayOfMonth(2, '2026-10-02')).toBe('2026-10-02');
  });
  it('validates', () => {
    expect(isValidISO('2026-02-30')).toBe(false);
    expect(isValidISO('2026-02-28')).toBe(true);
  });
});
