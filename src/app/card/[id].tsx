import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import {
  addCardPayment, deleteCardPayment, getCard, listCardPayments, listTransactions, saveCardDetails, sumTransactionsAfter,
  updateAccount,
} from '../../db/repo';
import {
  Body, Button, Card, Divider, Field, IconName, Label, ListItem, Money, ProgressBar, PromptModal, Row, Screen, Stat, Title,
} from '../../components/ui';
import { useColors } from '../../components/theme';
import { formatDate, today } from '../../lib/dates';
import { formatMoney, parseAmount, round2 } from '../../lib/money';
import { cycleStart, daysUntil, lastDayOfMonthOnOrBefore, nextDue, utilization } from '../../lib/cards';
import { estimateMinPayment, interestIfCarried } from '../../lib/payoff';

const num = (s: string) => (s.trim() ? parseAmount(s) : null);
const day = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export default function CardDetail() {
  const c = useColors();
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery(async (d) => {
    const card = await getCard(d, id);
    if (!card) return null;
    const payments = await listCardPayments(d, id);
    const txns = await listTransactions(d, { accountId: id, limit: 15 });
    const closeDate = card.statement_day ? lastDayOfMonthOnOrBefore(card.statement_day) : null;
    // owed at close = owed now + net activity since (purchases are negative, payments positive).
    const estimatedStatement =
      closeDate && card.source === 'simplefin' ? round2(card.owed + (await sumTransactionsAfter(d, id, closeDate))) : null;
    return { card, payments, txns, closeDate, estimatedStatement };
  }, [id]);

  const [form, setForm] = useState({ statement: '', statementDay: '', dueDay: '', min: '', apr: '', limit: '', balance: '' });
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    if (!data?.card || editing) return;
    const k = data.card;
    setForm({
      statement: str(k.statement_balance),
      statementDay: str(k.statement_day),
      dueDay: str(k.due_day),
      min: str(k.min_payment),
      apr: str(k.apr),
      limit: str(k.credit_limit),
      balance: str(k.owed),
    });
  }, [data, editing]);

  if (data === undefined) return <Screen>{null}</Screen>;
  if (data === null) return <Screen><Label>Card not found.</Label></Screen>;
  const { card, payments, txns, closeDate, estimatedStatement } = data;

  const start = cycleStart(card.statement_day);
  const paidThisCycle = payments.filter((p) => p.date >= start).reduce((s, p) => s + p.amount, 0);
  const due = nextDue(card.due_day);
  const util = utilization(card.owed, card.credit_limit);
  const statementLeft = card.statement_balance != null ? Math.max(0, card.statement_balance - paidThisCycle) : null;
  const apr = card.apr ?? 0;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    await saveCardDetails(db, {
      account_id: card.id,
      statement_balance: num(form.statement),
      statement_day: day(form.statementDay),
      due_day: day(form.dueDay),
      min_payment: num(form.min),
      apr: num(form.apr),
      credit_limit: num(form.limit),
    });
    const bal = num(form.balance);
    if (card.source === 'manual' && bal != null) await updateAccount(db, card.id, { balance: -Math.abs(bal) });
    setEditing(false);
  };

  return (
    <Screen>
      <Card>
        <Label>{card.institution || (card.source === 'manual' ? 'Manual card' : '')}</Label>
        <Body style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>{card.name}</Body>
        <Row style={{ marginBottom: 10 }}>
          <Stat label="Current balance" amount={card.owed} />
          <Stat label="Statement balance" amount={card.statement_balance ?? 0} sub={card.statement_balance == null ? 'Not set' : undefined} />
        </Row>
        {util != null && (
          <>
            <ProgressBar value={card.owed} max={card.credit_limit!} color={util > 0.3 ? c.warning : c.positive} />
            <Label style={{ marginTop: 4, fontSize: 12 }}>
              {Math.round(util * 100)}% of {formatMoney(card.credit_limit!, { cents: false })} · {formatMoney(card.credit_limit! - card.owed, { cents: false })} available
            </Label>
          </>
        )}
      </Card>

      <Card>
        <Title>Statement</Title>
        {due ? (
          <Body style={{ marginBottom: 6 }}>
            Due {formatDate(due, { weekday: 'short', month: 'short', day: 'numeric' })} · {daysUntil(due)} days
          </Body>
        ) : (
          <Label style={{ marginBottom: 6 }}>Set the due day to get due dates.</Label>
        )}
        {statementLeft != null && card.statement_balance! > 0 && (
          <>
            <ProgressBar value={paidThisCycle} max={card.statement_balance!} color={c.positive} overColor={c.positive} />
            <Label style={{ marginTop: 4 }}>
              {statementLeft > 0
                ? `${formatMoney(statementLeft)} left to pay the statement in full and avoid interest`
                : 'Statement paid in full — no interest this cycle ✓'}
            </Label>
          </>
        )}
        <Label style={{ marginTop: 6 }}>
          {formatMoney(paidThisCycle)} sent since {formatDate(start)}.
          {card.min_payment ? ` Minimum due ${formatMoney(card.min_payment)}.` : card.owed > 0 ? ` Estimated minimum ${formatMoney(estimateMinPayment(card.owed, apr || 24))}.` : ''}
        </Label>
        {apr > 0 && card.owed > 0 && (
          <Label style={{ marginTop: 6 }}>
            Carrying the current balance costs about {formatMoney(interestIfCarried(card.owed, apr))} in interest per month.
          </Label>
        )}
        {estimatedStatement != null && closeDate && Math.abs(estimatedStatement - (card.statement_balance ?? -1)) > 0.009 && (
          <View style={{ marginTop: 10 }}>
            <Label>Estimated from synced transactions: {formatMoney(estimatedStatement)} on {formatDate(closeDate)}.</Label>
            <Button
              title="Use estimate"
              variant="ghost"
              onPress={() =>
                saveCardDetails(db, {
                  account_id: card.id,
                  statement_balance: Math.max(0, estimatedStatement),
                  statement_day: card.statement_day,
                  due_day: card.due_day,
                  min_payment: card.min_payment,
                  apr: card.apr,
                  credit_limit: card.credit_limit,
                })
              }
            />
          </View>
        )}
        <Button title="Log a payment" icon="add" style={{ marginTop: 10 }} onPress={() => setLogging(true)} />
      </Card>

      <Card>
        <Title right={!editing && <Button title="Edit" variant="ghost" onPress={() => setEditing(true)} />}>Card details</Title>
        {editing ? (
          <>
            {card.source === 'manual' && (
              <Field label="Current balance owed" value={form.balance} onChangeText={set('balance')} keyboardType="decimal-pad" />
            )}
            <Field label="Statement balance" value={form.statement} onChangeText={set('statement')} keyboardType="decimal-pad" placeholder="From your latest statement" />
            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Statement closes (day)" value={form.statementDay} onChangeText={set('statementDay')} keyboardType="number-pad" placeholder="1-31" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Payment due (day)" value={form.dueDay} onChangeText={set('dueDay')} keyboardType="number-pad" placeholder="1-31" />
              </View>
            </Row>
            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Minimum payment" value={form.min} onChangeText={set('min')} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="APR %" value={form.apr} onChangeText={set('apr')} keyboardType="decimal-pad" placeholder="e.g. 24.99" />
              </View>
            </Row>
            <Field label="Credit limit" value={form.limit} onChangeText={set('limit')} keyboardType="decimal-pad" />
            <Row style={{ gap: 10 }}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(false)} />
              <Button title="Save" style={{ flex: 1 }} onPress={save} />
            </Row>
          </>
        ) : (
          <>
            <ListItem title="APR" right={<Body>{card.apr != null ? `${card.apr}%` : '—'}</Body>} />
            <Divider />
            <ListItem title="Minimum payment" right={<Body>{card.min_payment != null ? formatMoney(card.min_payment) : '—'}</Body>} />
            <Divider />
            <ListItem title="Statement closes" right={<Body>{card.statement_day ? `Day ${card.statement_day}` : '—'}</Body>} />
            <Divider />
            <ListItem title="Payment due" right={<Body>{card.due_day ? `Day ${card.due_day}` : '—'}</Body>} />
            <Divider />
            <ListItem title="Credit limit" right={<Body>{card.credit_limit != null ? formatMoney(card.credit_limit, { cents: false }) : '—'}</Body>} />
          </>
        )}
      </Card>

      <Card>
        <Title>Payments</Title>
        {payments.length === 0 && <Label>No payments yet. Synced payments appear automatically.</Label>}
        {payments.slice(0, 24).map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider />}
            <ListItem
              icon="arrow-up-circle"
              iconColor={c.positive}
              title={formatMoney(p.amount)}
              subtitle={`${formatDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })}${p.transaction_id ? ' · synced' : ' · logged'}${p.note ? ` · ${p.note}` : ''}`}
              onPress={
                p.transaction_id
                  ? undefined
                  : () =>
                      Alert.alert('Delete this payment?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteCardPayment(db, p.id) },
                      ])
              }
            />
          </View>
        ))}
      </Card>

      {txns.length > 0 && (
        <Card>
          <Title>Recent activity</Title>
          {txns.map((t, i) => (
            <View key={t.id}>
              {i > 0 && <Divider />}
              <ListItem
                icon={(t.category_icon as IconName) ?? 'help-circle'}
                iconColor={t.category_color ?? c.muted}
                title={t.description}
                subtitle={formatDate(t.date)}
                right={<Money amount={t.amount} colored />}
                onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
              />
            </View>
          ))}
        </Card>
      )}

      <Button title="Account settings" variant="ghost" onPress={() => router.push({ pathname: '/account/[id]', params: { id: card.id } })} />

      <PromptModal
        visible={logging}
        title="Log a payment"
        message={`Records money you sent to ${card.name} today${card.source === 'manual' ? ' and lowers its balance' : ''}.`}
        placeholder="Amount"
        onClose={() => setLogging(false)}
        onSubmit={async (v) => {
          const n = parseAmount(v);
          if (n == null || n <= 0) return;
          await addCardPayment(db, { cardId: card.id, date: today(), amount: Math.abs(n) });
          if (card.source === 'manual') await updateAccount(db, card.id, { balance: -Math.max(0, card.owed - Math.abs(n)) });
        }}
      />
    </Screen>
  );
}
