import { useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ACCOUNT_TYPES, AccountType, createManualAccount, saveCardDetails } from '../../db/repo';
import { Button, Card, Field, Label, Screen, Segmented } from '../../components/ui';
import { parseAmount } from '../../lib/money';

const TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Card', loan: 'Loan', investment: 'Invest',
};

export default function NewAccount() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ type?: AccountType }>();
  const [type, setType] = useState<AccountType>(params.type ?? 'checking');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [balance, setBalance] = useState('');
  const [apr, setApr] = useState('');
  const [limit, setLimit] = useState('');
  const owes = type === 'credit' || type === 'loan';

  const save = async () => {
    if (!name.trim()) return Alert.alert('Enter a name');
    const b = parseAmount(balance || '0');
    if (b == null) return Alert.alert('Balance must be a number');
    const id = await createManualAccount(db, {
      name: name.trim(),
      institution: institution.trim(),
      type,
      balance: owes ? -Math.abs(b) : b,
    });
    if (type === 'credit') {
      await saveCardDetails(db, {
        account_id: id, statement_balance: null, statement_day: null, due_day: null, min_payment: null,
        apr: apr ? parseAmount(apr) : null, credit_limit: limit ? parseAmount(limit) : null,
      });
      router.replace({ pathname: '/card/[id]', params: { id } });
    } else router.back();
  };

  return (
    <Screen>
      <Segmented value={type} onChange={setType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder={type === 'credit' ? 'e.g. Chase Freedom' : 'e.g. Everyday Checking'} />
        <Field label="Institution" value={institution} onChangeText={setInstitution} placeholder="Optional" />
        <Field label={owes ? 'Amount owed' : 'Current balance'} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0.00" />
        {type === 'credit' && (
          <>
            <Field label="APR %" value={apr} onChangeText={setApr} keyboardType="decimal-pad" placeholder="e.g. 24.99" />
            <Field label="Credit limit" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="Optional" />
          </>
        )}
      </Card>
      <Label>Manual accounts are updated by you (or by importing a CSV).</Label>
      <Button title="Add account" onPress={save} />
    </Screen>
  );
}
