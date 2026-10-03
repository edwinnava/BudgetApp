import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, listCardPayments, listCards } from './repo';
import { monthKey, today } from '../lib/dates';
import { allocatePayments, minimumFor, Strategy } from '../lib/payoff';
import { cycleStart, toDebtCard } from '../lib/cards';

/** Cards with what's been paid this cycle and this month's payoff allocation. */
export async function loadCardPlan(db: SQLiteDatabase) {
  const cards = await listCards(db);
  const earliest = cards.reduce((m, k) => {
    const s = cycleStart(k.statement_day);
    return s < m ? s : m;
  }, `${monthKey(today())}-01`);
  const payments = await listCardPayments(db, undefined, earliest);
  const paidThisCycle = new Map<string, number>();
  for (const k of cards) {
    const start = cycleStart(k.statement_day);
    paidThisCycle.set(k.id, payments.filter((p) => p.card_account_id === k.id && p.date >= start).reduce((s, p) => s + p.amount, 0));
  }
  const savedBudget = await getSetting(db, 'payoff_budget');
  const strategy = ((await getSetting(db, 'payoff_strategy')) ?? 'avalanche') as Strategy;
  const debts = cards.map(toDebtCard);
  const totalMin = debts.reduce((s, d) => s + minimumFor(d), 0);
  const budget = savedBudget ? Number(savedBudget) : Math.ceil(totalMin / 10) * 10;
  const plan = allocatePayments(debts, budget, strategy);
  return { cards, paidThisCycle, debts, totalMin, budget, budgetIsDefault: !savedBudget, strategy, plan };
}
