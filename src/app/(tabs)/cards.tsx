import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import { cardPaymentsByMonth, getSetting, listCardPayments, listCards, setSetting, Card as CardRow } from '../../db/repo';
import {
  Body, Button, Card, Divider, Empty, Label, ListItem, Money, ProgressBar, PromptModal, Row, Screen, Segmented, Stat, Title,
} from '../../components/ui';
import { useColors } from '../../components/theme';
import { addMonths, formatDate, formatMonth, monthKey, today } from '../../lib/dates';
import { formatMoney, parseAmount } from '../../lib/money';
import { allocatePayments, simulatePayoff, STRATEGY_INFO, Strategy, minimumFor } from '../../lib/payoff';
import { ASSUMED_APR, cycleStart, daysUntil, nextDue, toDebtCard, utilization } from '../../lib/cards';

async function load(db: Parameters<typeof listCards>[0]) {
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
  const history = await cardPaymentsByMonth(db, addMonths(`${monthKey(today())}-01`, -5));
  const budget = await getSetting(db, 'payoff_budget');
  const strategy = ((await getSetting(db, 'payoff_strategy')) ?? 'avalanche') as Strategy;
  return { cards, paidThisCycle, history, budget: budget ? Number(budget) : null, strategy };
}

function monthsLabel(n: number) {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(' ') || '0 mo';
}

export default function Cards() {
  const c = useColors();
  const db = useSQLiteContext();
  const { data } = useQuery(load);
  const [editingBudget, setEditingBudget] = useState(false);
  if (!data) return <Screen>{null}</Screen>;

  const { cards, paidThisCycle, history, strategy } = data;
  if (cards.length === 0) {
    return (
      <Screen>
        <Empty
          icon="card"
          title="No credit cards yet"
          message="Synced accounts that look like cards show up here automatically. You can also add a card manually or mark an account as a credit card."
          action={<Button title="Add a card" icon="add" onPress={() => router.push({ pathname: '/account/new', params: { type: 'credit' } })} />}
        />
      </Screen>
    );
  }

  const debts = cards.map(toDebtCard);
  const totalOwed = cards.reduce((s, k) => s + k.owed, 0);
  const totalStatement = cards.reduce((s, k) => s + (k.statement_balance ?? 0), 0);
  const totalLimit = cards.reduce((s, k) => s + (k.credit_limit ?? 0), 0);
  const totalMin = debts.reduce((s, d) => s + minimumFor(d), 0);
  const budget = data.budget ?? Math.ceil(totalMin / 10) * 10;
  const plan = allocatePayments(debts, budget, strategy);
  const sim = simulatePayoff(debts, budget, strategy);
  const minOnly = simulatePayoff(debts, totalMin, strategy);
  const paidTotal = [...paidThisCycle.values()].reduce((a, b) => a + b, 0);
  const missingApr = cards.filter((k) => k.owed > 0 && k.apr == null);
  const debtFreeDate = sim.feasible ? formatMonth(monthKey(addMonths(today(), sim.months - 1))) : null;

  return (
    <Screen>
      <Card>
        <Row style={{ marginBottom: 10 }}>
          <Stat label="Current balance" amount={totalOwed} color={totalOwed > 0 ? c.negative : undefined} />
          <Stat label="Statement balances" amount={totalStatement} />
        </Row>
        {totalLimit > 0 && (
          <>
            <ProgressBar value={totalOwed} max={totalLimit} color={totalOwed / totalLimit > 0.3 ? c.warning : c.positive} />
            <Label style={{ marginTop: 4, fontSize: 12 }}>
              {Math.round((totalOwed / totalLimit) * 100)}% utilization of {formatMoney(totalLimit, { cents: false })} limit
              {totalOwed / totalLimit > 0.3 ? ' · under 30% helps your credit score' : ''}
            </Label>
          </>
        )}
      </Card>

      {totalOwed > 0 && (
        <Card>
          <Title right={<Button title="Edit" variant="ghost" onPress={() => setEditingBudget(true)} />}>Payoff plan</Title>
          <Row style={{ marginBottom: 12 }}>
            <Stat label="Monthly payment" amount={budget} sub={data.budget ? undefined : 'Default: minimums'} />
            <View style={{ flex: 1 }}>
              <Label>Debt-free</Label>
              <Body style={{ fontSize: 20, fontWeight: '700' }}>{debtFreeDate ?? 'Never'}</Body>
              <Label style={{ fontSize: 12 }}>{sim.feasible ? `${monthsLabel(sim.months)} · ${formatMoney(sim.totalInterest, { cents: false })} interest` : 'Payment too low'}</Label>
            </View>
          </Row>
          <Segmented
            value={strategy}
            onChange={(v) => setSetting(db, 'payoff_strategy', v)}
            options={(Object.keys(STRATEGY_INFO) as Strategy[]).map((s) => ({ value: s, label: STRATEGY_INFO[s].label }))}
          />
          <Label style={{ marginTop: 8 }}>{STRATEGY_INFO[strategy].description}</Label>
          {sim.feasible && minOnly.feasible && minOnly.totalInterest - sim.totalInterest > 1 && (
            <Label style={{ marginTop: 6, color: c.positive }}>
              vs. minimum payments only: saves {formatMoney(minOnly.totalInterest - sim.totalInterest, { cents: false })} and{' '}
              {monthsLabel(minOnly.months - sim.months)}.
            </Label>
          )}
          {!minOnly.feasible && sim.feasible && (
            <Label style={{ marginTop: 6, color: c.positive }}>Paying only minimums would take decades. This plan gets you out.</Label>
          )}
          {plan.shortfall > 0 && (
            <Label style={{ marginTop: 6, color: c.negative }}>
              {formatMoney(plan.shortfall)} short of the combined minimum payments ({formatMoney(plan.totalMinimum)}).
            </Label>
          )}
          {missingApr.length > 0 && (
            <Label style={{ marginTop: 6, color: c.warning }}>
              APR missing for {missingApr.map((k) => k.name).join(', ')} — assuming {ASSUMED_APR}%. Tap the card to set it.
            </Label>
          )}
          {budget >= totalStatement && totalStatement > 0 && (
            <Label style={{ marginTop: 6 }}>
              Tip: your payment covers all statement balances. Paying each statement in full by its due date means no interest at all.
            </Label>
          )}
        </Card>
      )}

      {totalOwed > 0 && (
        <Card>
          <Title right={<Label>{formatMoney(paidTotal)} sent</Label>}>This cycle</Title>
          {plan.allocations.map((a, i) => {
            const k = cards.find((x) => x.id === a.id)!;
            const paid = paidThisCycle.get(k.id) ?? 0;
            const due = nextDue(k.due_day);
            return (
              <View key={a.id} style={{ paddingVertical: 8 }}>
                {i > 0 && <Divider />}
                <Row style={{ marginTop: i > 0 ? 8 : 0, marginBottom: 6 }}>
                  <Body style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>{k.name}</Body>
                  <Label>pay </Label>
                  <Money amount={a.total} />
                </Row>
                <ProgressBar value={paid} max={a.total} color={c.positive} overColor={c.positive} />
                <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <Label style={{ fontSize: 12 }}>
                    {formatMoney(paid)} sent{paid >= a.total ? ' ✓' : ` · ${formatMoney(a.total - paid)} to go`}
                  </Label>
                  <Label style={{ fontSize: 12 }}>
                    {a.extra > 0 ? `min ${formatMoney(a.minimum)} + ${formatMoney(a.extra)} extra` : 'minimum'}
                    {due ? ` · due ${formatDate(due)}` : ''}
                  </Label>
                </Row>
              </View>
            );
          })}
          {plan.leftover > 0 && <Label>{formatMoney(plan.leftover)} of your monthly payment isn't needed — all cards would be paid off.</Label>}
        </Card>
      )}

      <Card>
        <Title right={<Button title="Add card" variant="ghost" onPress={() => router.push({ pathname: '/account/new', params: { type: 'credit' } })} />}>
          Cards
        </Title>
        {cards.map((k: CardRow, i) => {
          const due = nextDue(k.due_day);
          const util = utilization(k.owed, k.credit_limit);
          const statementLeft = k.statement_balance != null ? Math.max(0, k.statement_balance - (paidThisCycle.get(k.id) ?? 0)) : null;
          const sub = [
            k.apr != null ? `${k.apr}% APR` : 'APR not set',
            due ? `due ${formatDate(due)} (${daysUntil(due)}d)` : null,
            util != null ? `${Math.round(util * 100)}% used` : null,
          ].filter(Boolean).join(' · ');
          return (
            <View key={k.id}>
              {i > 0 && <Divider />}
              <ListItem
                icon="card"
                title={k.name}
                subtitle={sub}
                right={<Money amount={k.owed} />}
                rightSub={statementLeft != null ? (statementLeft > 0 ? `${formatMoney(statementLeft)} stmt left` : 'Statement paid ✓') : undefined}
                onPress={() => router.push({ pathname: '/card/[id]', params: { id: k.id } })}
              />
            </View>
          );
        })}
      </Card>

      {history.length > 0 && (
        <Card>
          <Title>Sent to cards</Title>
          {history.map((h) => {
            const max = Math.max(...history.map((x) => x.total));
            return (
              <View key={h.month} style={{ paddingVertical: 6 }}>
                <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <Label>{formatMonth(h.month)}</Label>
                  <Money amount={h.total} size={14} />
                </Row>
                <ProgressBar value={h.total} max={max} color={c.positive} height={6} overColor={c.positive} />
              </View>
            );
          })}
          <Label style={{ marginTop: 4, fontSize: 12 }}>Last 6 months, from synced card payments and payments you logged.</Label>
        </Card>
      )}

      <PromptModal
        visible={editingBudget}
        title="Monthly payment toward cards"
        message={`Total you can put toward all cards each month. Minimums add up to ${formatMoney(totalMin)}.`}
        initial={String(budget)}
        onClose={() => setEditingBudget(false)}
        onSubmit={(v) => {
          const n = parseAmount(v);
          if (n != null && n > 0) setSetting(db, 'payoff_budget', String(n));
        }}
      />
    </Screen>
  );
}
