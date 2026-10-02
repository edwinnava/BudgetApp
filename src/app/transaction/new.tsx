import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { addManualTransaction, Account, Category } from '../../db/repo';
import { Button, Card, Field, IconName, ListItem, Screen, Segmented, Divider } from '../../components/ui';
import { AccountPicker, CategoryPicker } from '../../components/pickers';
import { isValidISO, today } from '../../lib/dates';
import { parseAmount } from '../../lib/money';

export default function NewTransaction() {
  const db = useSQLiteContext();
  const [account, setAccount] = useState<Account | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [picker, setPicker] = useState<'account' | 'category' | null>(null);

  const save = async () => {
    const n = parseAmount(amount);
    if (!account) return Alert.alert('Choose an account');
    if (!description.trim()) return Alert.alert('Enter a description');
    if (n == null || n === 0) return Alert.alert('Enter an amount');
    if (!isValidISO(date)) return Alert.alert('Date must be YYYY-MM-DD');
    await addManualTransaction(db, {
      accountId: account.id,
      date,
      amount: direction === 'out' ? -Math.abs(n) : Math.abs(n),
      description: description.trim(),
      categoryId: category?.id ?? null,
    });
    router.back();
  };

  return (
    <Screen>
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]}
      />
      <Card>
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. Farmers market" />
        <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      </Card>
      <Card>
        <ListItem icon="wallet" title={account?.name ?? 'Choose account'} subtitle="Account" onPress={() => setPicker('account')} />
        <Divider />
        <ListItem
          icon={(category?.icon as IconName) ?? 'pricetag'}
          iconColor={category?.color}
          title={category?.name ?? 'Uncategorized'}
          subtitle="Category"
          onPress={() => setPicker('category')}
        />
      </Card>
      <Button title="Save" onPress={save} />
      <AccountPicker visible={picker === 'account'} onClose={() => setPicker(null)} onPick={setAccount} />
      <CategoryPicker visible={picker === 'category'} onClose={() => setPicker(null)} onPick={setCategory} allowNone />
    </Screen>
  );
}
