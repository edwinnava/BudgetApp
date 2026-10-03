/**
 * Plans local due-date notifications for credit cards and recurring bills.
 * Pure so it can be tested; the scheduler in src/notifications turns the plan into OS notifications.
 */
import { addDays, addMonths, formatDate, ISODate, monthKey, nextDayOfMonth, parseISO, today } from './dates';
import { formatMoney } from './money';
import { BillLike, upcomingBills } from './bills';

export interface ReminderSettings {
  enabled: boolean;
  cardDaysBefore: number; // 0 = only on the due date
  billsEnabled: boolean;
  billDaysBefore: number;
  hour: number; // local hour of day to deliver
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  cardDaysBefore: 3,
  billsEnabled: true,
  billDaysBefore: 1,
  hour: 9,
};

export interface ReminderCard {
  id: string;
  name: string;
  owed: number;
  dueDay: number | null;
  statementBalance: number | null;
  paidThisCycle: number;
  minPayment: number | null;
  suggestedPayment: number | null; // from the payoff plan
}

export interface PlannedReminder {
  key: string;
  date: Date;
  title: string;
  body: string;
  url: string; // in-app route to open when tapped
}

/** iOS keeps at most 64 pending local notifications per app. */
export const MAX_REMINDERS = 60;

function at(date: ISODate, hour: number): Date {
  const d = parseISO(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const whenText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

function cardBody(c: ReminderCard, firstCycle: boolean): string {
  const parts: string[] = [];
  if (firstCycle && c.statementBalance != null && c.statementBalance > 0) {
    const left = Math.max(0, c.statementBalance - c.paidThisCycle);
    parts.push(`${formatMoney(left)} left on the statement to avoid interest.`);
  } else if (c.owed > 0) {
    parts.push(`Current balance ${formatMoney(c.owed)}.`);
  }
  if (firstCycle && c.suggestedPayment) parts.push(`Plan: pay ${formatMoney(c.suggestedPayment)}.`);
  else if (c.minPayment) parts.push(`Minimum ${formatMoney(c.minPayment)}.`);
  return parts.join(' ');
}

export function planReminders(
  input: { cards: ReminderCard[]; bills: (BillLike & { id: number })[]; settings: ReminderSettings },
  now: Date = new Date(),
): PlannedReminder[] {
  const { cards, bills, settings } = input;
  if (!settings.enabled) return [];
  const t = today();
  const out: PlannedReminder[] = [];
  const add = (r: PlannedReminder) => {
    if (r.date.getTime() > now.getTime()) out.push(r);
  };

  for (const c of cards) {
    if (!c.dueDay || c.owed <= 0) continue;
    const first = nextDayOfMonth(c.dueDay, t);
    // This cycle plus the next two, so reminders keep coming even if the app isn't opened for a while.
    const dues = [first, nextDayOfMonth(c.dueDay, addMonths(`${monthKey(first)}-01`, 1)), nextDayOfMonth(c.dueDay, addMonths(`${monthKey(first)}-01`, 2))];
    dues.forEach((due, i) => {
      const firstCycle = i === 0;
      const statementPaid =
        firstCycle && c.statementBalance != null && c.statementBalance > 0 && c.paidThisCycle >= c.statementBalance;
      if (statementPaid) return;
      const days = [...new Set([settings.cardDaysBefore, 0])];
      for (const d of days) {
        add({
          key: `card:${c.id}:${due}:${d}`,
          date: at(addDays(due, -d), settings.hour),
          title: `${c.name} payment due ${whenText(d)}`,
          body: `Due ${formatDate(due)}. ${cardBody(c, firstCycle)}`.trim(),
          url: `/card/${encodeURIComponent(c.id)}`,
        });
      }
    });
  }

  if (settings.billsEnabled) {
    for (const u of upcomingBills(bills, 62, t)) {
      add({
        key: `bill:${u.bill.id}:${u.date}`,
        date: at(addDays(u.date, -settings.billDaysBefore), settings.hour),
        title: `${u.bill.name} ${whenText(settings.billDaysBefore)}`,
        body: `${formatMoney(u.bill.amount)} due ${formatDate(u.date)}.`,
        url: `/recurring/edit?id=${u.bill.id}`,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, MAX_REMINDERS);
}
