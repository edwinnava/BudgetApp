import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import {
  dismissRecurringCandidate, listDismissedRecurring, listOutflowsSince, listRecurring, saveRecurring, getCategoryIdByName,
  listRules,
} from '../../db/repo';
import { Body, Button, Card, Empty, Label, Money, Row, Screen } from '../../components/ui';
import { addDays, formatDate, today } from '../../lib/dates';
import { detectRecurring, FREQUENCY_LABEL, RecurringCandidate } from '../../lib/recurring';
import { guessCategory } from '../../lib/categorize';

const DISCRETIONARY = new Set(['Groceries', 'Dining', 'Transportation', 'Shopping', 'Personal Care', 'Travel']);

async function load(db: Parameters<typeof listRecurring>[0]) {
  const [txns, existing, dismissed] = await Promise.all([
    listOutflowsSince(db, addDays(today(), -400)),
    listRecurring(db),
    listDismissedRecurring(db),
  ]);
  const tracked = new Set(existing.map((r) => r.merchant_key).filter(Boolean));
  const withFlags = txns.map((t) => ({ ...t, discretionary: !!t.category_name && DISCRETIONARY.has(t.category_name) }));
  return detectRecurring(withFlags).filter((c) => !tracked.has(c.merchantKey) && !dismissed.has(c.merchantKey));
}

export default function Discover() {
  const db = useSQLiteContext();
  const { data } = useQuery(load);

  const add = async (c: RecurringCandidate) => {
    const rules = await listRules(db);
    const catName = guessCategory({ description: c.merchantKey, amount: -c.averageAmount, accountType: 'checking' }, rules);
    await saveRecurring(db, {
      name: c.name,
      amount: c.lastAmount,
      frequency: c.frequency,
      anchor_date: c.nextDate,
      category_id: catName ? await getCategoryIdByName(db, catName) : null,
      merchant_key: c.merchantKey,
      notes: '',
      active: 1,
    });
  };

  if (!data) return <Screen><Label>Scanning transactions…</Label></Screen>;
  if (data.length === 0)
    return (
      <Screen>
        <Empty
          icon="checkmark-circle"
          title="Nothing new found"
          message="Recurring charges show up after at least two (monthly) or three (weekly) payments. Sync more history or add bills manually."
        />
      </Screen>
    );

  return (
    <Screen>
      <Label>
        These charges repeat on a regular schedule. Add the ones you want to track as bills.
      </Label>
      {data.length > 1 && <Button title={`Add all ${data.length}`} variant="secondary" onPress={async () => { for (const c of data) await add(c); }} />}
      {data.map((c) => (
        <Card key={c.merchantKey}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Body style={{ fontWeight: '600' }}>{c.name}</Body>
              <Label>
                {FREQUENCY_LABEL[c.frequency]} · {c.occurrences} charges · next {formatDate(c.nextDate)}
              </Label>
              <Label style={{ fontSize: 12 }}>Confidence {Math.round(c.confidence * 100)}%</Label>
            </View>
            <Money amount={c.lastAmount} />
          </Row>
          <Row style={{ gap: 10, marginTop: 10 }}>
            <Button title="Not a bill" variant="ghost" style={{ flex: 1 }} onPress={() => dismissRecurringCandidate(db, c.merchantKey)} />
            <Button title="Track it" icon="add" style={{ flex: 1 }} onPress={() => add(c)} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
