import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REMINDER_SETTINGS, planReminders, ReminderCard, MAX_REMINDERS } from '../reminders';

const settings = { ...DEFAULT_REMINDER_SETTINGS, enabled: true };
const card: ReminderCard = {
  id: 'c1', name: 'Visa', owed: 2000, dueDay: 28, statementBalance: 1500, paidThisCycle: 400, minPayment: 45, suggestedPayment: 300,
};

describe('planReminders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0)); // Oct 3 2026, noon
  });
  afterEach(() => vi.useRealTimers());

  it('does nothing when disabled', () => {
    expect(planReminders({ cards: [card], bills: [], settings: DEFAULT_REMINDER_SETTINGS })).toEqual([]);
  });

  it('schedules days-before and day-of reminders for three cycles', () => {
    const r = planReminders({ cards: [card], bills: [], settings: { ...settings, billsEnabled: false } });
    expect(r.map((x) => x.key)).toEqual([
      'card:c1:2026-10-28:3', 'card:c1:2026-10-28:0',
      'card:c1:2026-11-28:3', 'card:c1:2026-11-28:0',
      'card:c1:2026-12-28:3', 'card:c1:2026-12-28:0',
    ]);
    expect(r[0].date).toEqual(new Date(2026, 9, 25, 9, 0));
    expect(r[0].title).toBe('Visa payment due in 3 days');
    expect(r[0].body).toContain('$1,100.00 left on the statement');
    expect(r[0].body).toContain('Plan: pay $300.00');
    expect(r[2].body).toContain('Current balance $2,000.00');
    expect(r[0].url).toBe('/card/c1');
  });

  it('skips the current cycle when the statement is paid and cards with no balance', () => {
    const paid = planReminders({ cards: [{ ...card, paidThisCycle: 1500 }], bills: [], settings: { ...settings, billsEnabled: false } });
    expect(paid[0].key).toBe('card:c1:2026-11-28:3');
    expect(planReminders({ cards: [{ ...card, owed: 0 }], bills: [], settings })).toEqual([]);
  });

  it('never schedules in the past', () => {
    const r = planReminders({ cards: [{ ...card, dueDay: 4 }], bills: [], settings: { ...settings, billsEnabled: false } });
    // Oct 1 (3 days before Oct 4) has passed; Oct 4 day-of is kept.
    expect(r[0].key).toBe('card:c1:2026-10-04:0');
  });

  it('adds bill reminders and caps the total', () => {
    const bills = [{ id: 1, name: 'Netflix', amount: 15.49, frequency: 'monthly' as const, anchor_date: '2026-01-10', active: 1 }];
    const r = planReminders({ cards: [], bills, settings });
    expect(r.map((x) => x.key)).toEqual(['bill:1:2026-10-10', 'bill:1:2026-11-10']);
    expect(r[0].date).toEqual(new Date(2026, 9, 9, 9, 0));
    expect(r[0].title).toBe('Netflix tomorrow');
    const weekly = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `B${i}`, amount: 1, frequency: 'weekly' as const, anchor_date: '2026-10-05', active: 1 }));
    expect(planReminders({ cards: [], bills: weekly, settings })).toHaveLength(MAX_REMINDERS);
  });
});
