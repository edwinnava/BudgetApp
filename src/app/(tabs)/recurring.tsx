import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '../../db/hooks';
import { listRecurring, lastChargeFor, Recurring } from '../../db/repo';
import { Button, Card, Divider, Empty, Label, ListItem, Money, Row, Screen, Stat, Title } from '../../components/ui';
import { formatDate, today } from '../../lib/dates';
import { FREQUENCY_LABEL, monthlyEquivalent, nextDueDate } from '../../lib/recurring';
import { daysUntil } from '../../lib/cards';
import { useColors } from '../../components/theme';

async function load(db: Parameters<typeof listRecurring>[0]) {
  const bills = await listRecurring(db);
  const withLast = await Promise.all(
    bills.map(async (b) => ({ ...b, last: b.merchant_key ? await lastChargeFor(db, b.merchant_key) : null })),
  );
  return withLast;
}

function dueLabel(b: Recurring) {
  const next = nextDueDate(b.anchor_date, b.frequency, today());
  const d = daysUntil(next);
  return { next, text: d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due ${formatDate(next)} · ${d} days` };
}

export default function RecurringScreen() {
  const c = useColors();
  const { data } = useQuery(load);
  if (!data) return <Screen>{null}</Screen>;

  const active = data.filter((b) => b.active).sort((a, b) => (dueLabel(a).next < dueLabel(b).next ? -1 : 1));
  const inactive = data.filter((b) => !b.active);
  const monthly = active.reduce((s, b) => s + monthlyEquivalent(b.amount, b.frequency), 0);

  return (
    <Screen>
      <Card>
        <Row>
          <Stat label="Monthly bills" amount={monthly} sub={`${active.length} active`} />
          <Stat label="Yearly" amount={monthly * 12} />
        </Row>
      </Card>
      <Row style={{ gap: 10 }}>
        <Button title="Find recurring" icon="search" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/recurring/discover')} />
        <Button title="Add bill" icon="add" style={{ flex: 1 }} onPress={() => router.push('/recurring/edit')} />
      </Row>

      {active.length === 0 ? (
        <Card>
          <Empty
            icon="repeat"
            title="No recurring bills yet"
            message="Tap Find recurring to scan your transactions for subscriptions and bills, or add them yourself."
          />
        </Card>
      ) : (
        <Card>
          <Title>Upcoming</Title>
          {active.map((b, i) => {
            const due = dueLabel(b);
            const soon = daysUntil(due.next) <= 3;
            return (
              <View key={b.id}>
                {i > 0 && <Divider />}
                <ListItem
                  icon="calendar"
                  iconColor={soon ? c.warning : undefined}
                  title={b.name}
                  subtitle={`${due.text}${b.last ? ` · last ${formatDate(b.last.date)}` : ''}`}
                  right={<Money amount={b.amount} />}
                  rightSub={FREQUENCY_LABEL[b.frequency]}
                  onPress={() => router.push({ pathname: '/recurring/edit', params: { id: String(b.id) } })}
                />
              </View>
            );
          })}
        </Card>
      )}

      {inactive.length > 0 && (
        <Card>
          <Title>Cancelled / paused</Title>
          {inactive.map((b, i) => (
            <View key={b.id}>
              {i > 0 && <Divider />}
              <ListItem
                icon="pause-circle"
                iconColor={c.muted}
                title={b.name}
                right={<Money amount={b.amount} style={{ color: c.muted }} />}
                rightSub={FREQUENCY_LABEL[b.frequency]}
                onPress={() => router.push({ pathname: '/recurring/edit', params: { id: String(b.id) } })}
              />
            </View>
          ))}
          <Label style={{ marginTop: 6 }}>Paused bills don't count toward totals.</Label>
        </Card>
      )}
    </Screen>
  );
}
