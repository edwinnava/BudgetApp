import { describe, expect, it } from 'vitest';
import { cycleStart, lastDayOfMonthOnOrBefore, nextDue, utilization } from '../cards';

describe('cards', () => {
  it('finds the last statement date', () => {
    expect(lastDayOfMonthOnOrBefore(25, '2026-10-02')).toBe('2026-09-25');
    expect(lastDayOfMonthOnOrBefore(2, '2026-10-02')).toBe('2026-10-02');
    expect(lastDayOfMonthOnOrBefore(1, '2026-10-02')).toBe('2026-10-01');
    expect(lastDayOfMonthOnOrBefore(31, '2026-10-15')).toBe('2026-09-30');
    expect(lastDayOfMonthOnOrBefore(31, '2026-03-02')).toBe('2026-02-28');
  });
  it('computes cycle start and due', () => {
    expect(cycleStart(null, '2026-10-02')).toBe('2026-10-01');
    expect(cycleStart(20, '2026-10-02')).toBe('2026-09-20');
    expect(nextDue(15, '2026-10-02')).toBe('2026-10-15');
    expect(nextDue(null)).toBeNull();
    expect(utilization(500, 2000)).toBe(0.25);
  });
});
