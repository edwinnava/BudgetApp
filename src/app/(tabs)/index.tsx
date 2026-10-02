import { router } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '../../db/hooks';
import {
  budgetLines, getSetting, listAccounts, listCards, listRecurring, listTransactions, monthIncome, owedFor, Account,
} from '../../db/repo';
import { useSync } from '../../sync/useSync';
import {
  Body, Button, Card, Divider, Empty, IconName, Label, ListItem, Money, ProgressBar, Row, Screen, Stat, Title,
} from '../../components/ui';
import { useColors } from '../../components/theme';
import { formatDate, monthKey, today } from '../../lib/dates';
import { upcomingBills } from '../../lib/bills';
import { nextDue, daysUntil } from '../../lib/cards';
import { formatMoney } from '../../lib/money';

async function load(db: Parameters<typeof listAccounts>[0]) {
  const month = monthKey(today());
  const [accounts, cards, lines, income, bills, recent, lastSync] = await Promise.all([
    listAccounts(db, false),
    listCards(db),
    budgetLines(db, month),
    monthIncome(db, month),
    listRecurring(db),
    listTransactions(db, { limit: 6 }),
    getSetting(db, 'last_sync_at'),
  ]);
  return { accounts, cards, lines, income, bills, recent, lastSync };
}

const isCash = (a: Account) => a.type === 'checking' || a.type === 'savings';

export default function Overview() {
  const c = useColors();
  const { data } = useQuery(load);
  const { syncing, sync, connected } = useSync();
  if (!data) return <Screen>{null}</Screen>;

  const { accounts, cards, lines, income, bills, recent, lastSync } = data;
  const spent = lines.reduce((s, l) => s + l.spent, 0);
  const budgeted = lines.reduce((s, l) => s + (l.budget ?? 0), 0);
  const budgetedSpent = lines.filter((l) => l.budget).reduce((s, l) => s + l.spent, 0);
  const cash = accounts.filter(isCash).reduce((s, a) => s + a.balance, 0);
  const debt = accounts.filter((a) => a.type === 'credit' || a.type === 'loan').reduce((s, a) => s + owedFor(a.balance), 0);
  const upcoming = upcomingBills(bills, 14);
  const upcomingTotal = upcoming.reduce((s, u) => s + u.bill.amount, 0);
  const cardDebt = cards.reduce((s, k) => s + k.owed, 0);
  const nextCardDue = cards
    .map((k) => ({ k, due: nextDue(k.due_day) }))
    .filter((x) => x.due && x.k.owed > 0)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))[0];

  if (accounts.length === 0) {
    return (
      <Screen>
        <Empty
          icon="wallet"
          title="Welcome to your budget"
          message="Everything stays on this device. Connect your banks with SimpleFIN, import a CSV, or add accounts manually."
          action={<Button title="Get started" icon="add" onPress={() => router.push('/settings')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={syncing} onRefresh={connected ? sync : undefined}>
      {connected && (
        <Label>
          {lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}` : 'Not synced yet'} · pull down to sync
        </Label>
      )}

      <Card>
        <Row>
          <Stat label="Cash" amount={cash} />
          <Stat label="Debt" amount={-debt} color={debt > 0 ? c.negative : undefined} />
          <Stat label="Net" amount={cash - debt} />
        </Row>
      </Card>

      <Card onPress={() => router.push('/budget')}>
        <Title>This month</Title>
        <Row style={{ marginBottom: 10 }}>
          <Stat
            label="Spent"
            amount={spent}
            sub={budgeted ? `${formatMoney(budgetedSpent, { cents: false })} of ${formatMoney(budgeted, { cents: false })} budgeted` : 'No budget set'}
          />
          <Stat label="Income" amount={income} color={c.positive} />
        </Row>
        {budgeted > 0 && <ProgressBar value={budgetedSpent} max={budgeted} />}
      </Card>

      <Card onPress={() => router.push('/recurring')}>
        <Title right={<Label>{formatMoney(upcomingTotal)}</Label>}>Upcoming bills · 14 days</Title>
        {upcoming.length === 0 ? (
          <Label>No bills due soon. Add or detect recurring bills in the Recurring tab.</Label>
        ) : (
          upcoming.slice(0, 5).map((u, i) => (
            <View key={`${u.bill.id}-${u.date}`}>
              {i > 0 && <Divider />}
              <ListItem
                icon="calendar"
                title={u.bill.name}
                subtitle={formatDate(u.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                right={<Money amount={u.bill.amount} />}
              />
            </View>
          ))
        )}
      </Card>

      {cards.length > 0 && (
        <Card onPress={() => router.push('/cards')}>
          <Title>Credit cards</Title>
          <Row>
            <Stat label="Total owed" amount={cardDebt} color={cardDebt > 0 ? c.negative : undefined} />
            {nextCardDue && (
              <View style={{ flex: 1 }}>
                <Label>Next due</Label>
                <Body style={{ fontWeight: '600', fontSize: 16 }}>{formatDate(nextCardDue.due!)}</Body>
                <Label style={{ fontSize: 12 }}>
                  {nextCardDue.k.name} · {daysUntil(nextCardDue.due!)} days
                </Label>
              </View>
            )}
          </Row>
        </Card>
      )}

      <Card>
        <Title right={<Button title="See all" variant="ghost" onPress={() => router.push('/transactions')} />}>
          Recent transactions
        </Title>
        {recent.map((t, i) => (
          <View key={t.id}>
            {i > 0 && <Divider />}
            <ListItem
              icon={(t.category_icon as IconName) ?? 'help-circle'}
              iconColor={t.category_color ?? c.muted}
              title={t.description}
              subtitle={`${formatDate(t.date)} · ${t.category_name ?? 'Uncategorized'}`}
              right={<Money amount={t.amount} colored />}
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
