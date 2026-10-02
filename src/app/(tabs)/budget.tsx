import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '../../db/hooks';
import { budgetLines, monthIncome, setBudget, BudgetLine } from '../../db/repo';
import { Card, Divider, IconButton, Label, Money, ProgressBar, PromptModal, Row, Screen, Stat, Title, IconName } from '../../components/ui';
import { useColors } from '../../components/theme';
import { formatMonth, monthKey, shiftMonth, today, monthRange, daysBetween } from '../../lib/dates';
import { formatMoney, parseAmount } from '../../lib/money';

export default function Budget() {
  const c = useColors();
  const db = useSQLiteContext();
  const [month, setMonth] = useState(monthKey(today()));
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const { data } = useQuery(async (d) => ({ lines: await budgetLines(d, month), income: await monthIncome(d, month) }), [month]);
  if (!data) return <Screen>{null}</Screen>;

  const { lines, income } = data;
  const budgeted = lines.filter((l) => l.budget);
  const unbudgeted = lines.filter((l) => !l.budget && l.category_id !== -1);
  const uncategorized = lines.find((l) => l.category_id === -1);
  const totalBudget = budgeted.reduce((s, l) => s + (l.budget ?? 0), 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  const budgetedSpent = budgeted.reduce((s, l) => s + l.spent, 0);
  const left = totalBudget - budgetedSpent;
  const isCurrent = month === monthKey(today());
  const { start, end } = monthRange(month);
  const daysLeft = isCurrent ? daysBetween(today(), end) + 1 : 0;
  const elapsed = isCurrent ? (daysBetween(start, today()) + 1) / (daysBetween(start, end) + 1) : 1;

  const line = (l: BudgetLine, i: number) => {
    const remaining = (l.budget ?? 0) - l.spent;
    return (
      <View key={l.category_id}>
        {i > 0 && <Divider />}
        <Pressable
          onPress={() => (l.category_id === -1 ? router.push({ pathname: '/transactions', params: { categoryId: '-1', month } }) : setEditing(l))}
          onLongPress={() => router.push({ pathname: '/transactions', params: { categoryId: String(l.category_id), month } })}
          style={{ paddingVertical: 10 }}
        >
          <Row style={{ marginBottom: l.budget ? 6 : 0 }}>
            <Ionicons name={l.icon as IconName} size={18} color={l.color} style={{ marginRight: 10 }} />
            <Text style={{ flex: 1, color: c.text, fontSize: 15 }}>{l.name}</Text>
            <Money amount={l.spent} />
            {!!l.budget && <Label> / {formatMoney(l.budget, { cents: false })}</Label>}
          </Row>
          {!!l.budget && (
            <>
              <ProgressBar value={l.spent} max={l.budget} color={l.color} />
              <Label style={{ marginTop: 4, fontSize: 12, color: remaining < 0 ? c.negative : c.muted }}>
                {remaining >= 0 ? `${formatMoney(remaining)} left` : `${formatMoney(-remaining)} over`}
              </Label>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} />
        <Text style={{ color: c.text, fontWeight: '700', fontSize: 17 }}>{formatMonth(month)}</Text>
        <IconButton icon="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} />
      </Row>

      <Card>
        <Row style={{ marginBottom: 10 }}>
          <Stat label="Total spent" amount={totalSpent} />
          <Stat label="Income" amount={income} color={c.positive} />
          {totalBudget > 0 && <Stat label="Budget left" amount={left} color={left < 0 ? c.negative : undefined} />}
        </Row>
        {totalBudget > 0 && (
          <>
            <ProgressBar value={budgetedSpent} max={totalBudget} height={10} />
            <Label style={{ marginTop: 6, fontSize: 12 }}>
              {formatMoney(budgetedSpent, { cents: false })} of {formatMoney(totalBudget, { cents: false })} budgeted
              {isCurrent ? ` · ${daysLeft} days left, ${Math.round(elapsed * 100)}% of month gone` : ''}
              {isCurrent && left > 0 ? ` · ${formatMoney(left / daysLeft)}/day` : ''}
            </Label>
          </>
        )}
      </Card>

      {budgeted.length > 0 && (
        <Card>
          <Title>Budgeted</Title>
          {budgeted.map(line)}
        </Card>
      )}

      <Card>
        <Title>{budgeted.length ? 'Other categories' : 'Categories'}</Title>
        <Label style={{ marginBottom: 4 }}>Tap to set a monthly budget · long-press to see transactions</Label>
        {unbudgeted.map(line)}
        {uncategorized && (
          <>
            <Divider />
            {line(uncategorized, 0)}
          </>
        )}
      </Card>

      <PromptModal
        visible={!!editing}
        title={`Budget for ${editing?.name ?? ''}`}
        message="Monthly amount. Leave empty to remove."
        initial={editing?.budget ? String(editing.budget) : ''}
        placeholder="0"
        onClose={() => setEditing(null)}
        onSubmit={(v) => editing && setBudget(db, editing.category_id, parseAmount(v))}
      />
    </Screen>
  );
}
