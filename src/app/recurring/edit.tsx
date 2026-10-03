import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import {
  deleteRecurring, getRecurring, listCategories, listTransactions, saveRecurring, Category, Recurring, Transaction,
} from '../../db/repo';
import {
  Body, Button, Card, Divider, Field, IconName, Label, ListItem, Money, Row, Screen, Segmented, Title,
} from '../../components/ui';
import { CategoryPicker } from '../../components/pickers';
import { addDays, formatDate, isValidISO, today } from '../../lib/dates';
import { parseAmount } from '../../lib/money';
import { Frequency, FREQUENCIES, FREQUENCY_LABEL, nextDueDate, occurrencesBetween } from '../../lib/recurring';

export default function EditRecurring() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const billId = id ? Number(id) : undefined;
  const { data } = useQuery(async (d) => {
    const bill = billId ? await getRecurring(d, billId) : null;
    const categories = await listCategories(d);
    const history = bill?.merchant_key ? await listTransactions(d, { merchantKey: bill.merchant_key, limit: 12 }) : [];
    return { bill, categories, history };
  }, [billId]);
  if (!data) return <Screen>{null}</Screen>;
  return <BillForm key={billId ?? 'new'} billId={billId} {...data} />;
}

function BillForm({
  billId, bill, categories, history,
}: { billId?: number; bill: Recurring | null; categories: Category[]; history: Transaction[] }) {
  const db = useSQLiteContext();
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(bill ? String(bill.amount) : '');
  const [frequency, setFrequency] = useState<Frequency>(bill?.frequency ?? 'monthly');
  const [date, setDate] = useState(bill ? nextDueDate(bill.anchor_date, bill.frequency) : today());
  const [categoryId, setCategoryId] = useState<number | null>(bill?.category_id ?? null);
  const [active, setActive] = useState(bill ? !!bill.active : true);
  const [notes, setNotes] = useState(bill?.notes ?? '');
  const [picking, setPicking] = useState(false);

  const category = categories.find((c) => c.id === categoryId);

  const save = async () => {
    const n = parseAmount(amount);
    if (!name.trim()) return Alert.alert('Enter a name');
    if (n == null || n <= 0) return Alert.alert('Enter the bill amount');
    if (!isValidISO(date)) return Alert.alert('Next due date must be YYYY-MM-DD');
    await saveRecurring(db, {
      id: billId,
      name: name.trim(),
      amount: Math.abs(n),
      frequency,
      anchor_date: date,
      category_id: categoryId,
      merchant_key: bill?.merchant_key ?? null,
      notes,
      active: active ? 1 : 0,
    });
    router.back();
  };

  const preview = isValidISO(date) ? occurrencesBetween(date, frequency, today(), addDays(today(), 120)).slice(0, 4) : [];

  return (
    <Screen>
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Rent, Netflix" />
        <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <Field
          label="Next due date"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          hint={preview.length ? `Then ${preview.slice(1).map((d) => formatDate(d)).join(', ')}` : undefined}
        />
        <Label style={{ marginBottom: 6 }}>How often</Label>
        <Segmented
          value={frequency}
          onChange={setFrequency}
          options={FREQUENCIES.map((f) => ({ value: f, label: f === 'biweekly' ? '2 wks' : FREQUENCY_LABEL[f] }))}
        />
      </Card>
      <Card>
        <ListItem
          icon={(category?.icon as IconName) ?? 'pricetag'}
          iconColor={category?.color}
          title={category?.name ?? 'No category'}
          subtitle="Category"
          onPress={() => setPicking(true)}
        />
        <Divider />
        <Row style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
          <View>
            <Body>Active</Body>
            <Label>Turn off if you cancelled it</Label>
          </View>
          <Switch value={active} onValueChange={setActive} />
        </Row>
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Account number, cancel link…" multiline />
      </Card>
      <Button title="Save" onPress={save} />
      {billId != null && (
        <Button
          title="Delete bill"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete this bill?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await deleteRecurring(db, billId); router.back(); } },
            ])
          }
        />
      )}
      {history.length > 0 && (
        <Card>
          <Title>Payment history</Title>
          {history.map((t, i) => (
            <View key={t.id}>
              {i > 0 && <Divider />}
              <ListItem title={formatDate(t.date, { month: 'short', day: 'numeric', year: 'numeric' })} subtitle={t.account_name} right={<Money amount={t.amount} />} />
            </View>
          ))}
        </Card>
      )}
      <CategoryPicker visible={picking} onClose={() => setPicking(false)} onPick={(c) => setCategoryId(c?.id ?? null)} allowNone />
    </Screen>
  );
}
