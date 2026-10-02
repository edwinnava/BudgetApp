import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import { ACCOUNT_TYPES, AccountType, deleteAccount, getAccount, updateAccount } from '../../db/repo';
import { backfillCardPayments } from '../../sync/ingest';
import { Body, Button, Card, Field, Label, Row, Screen, Segmented } from '../../components/ui';
import { parseAmount } from '../../lib/money';

const TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Card', loan: 'Loan', investment: 'Invest',
};

export default function AccountDetail() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: account } = useQuery((d) => getAccount(d, id), [id]);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');

  useEffect(() => {
    if (account) {
      setName(account.name);
      setBalance(String(account.balance));
    }
  }, [account]);

  if (account === undefined) return <Screen>{null}</Screen>;
  if (!account) return <Screen><Label>Account not found.</Label></Screen>;

  const changeType = async (type: AccountType) => {
    await updateAccount(db, account.id, { type });
    if (type === 'credit') await backfillCardPayments(db, account.id);
  };

  return (
    <Screen>
      <Card>
        <Field label="Name" value={name} onChangeText={setName} onBlur={() => name.trim() && updateAccount(db, account.id, { name: name.trim() })} />
        {account.source === 'manual' && (
          <Field
            label="Balance"
            value={balance}
            onChangeText={setBalance}
            keyboardType="numbers-and-punctuation"
            hint="Use a negative number for money owed on cards and loans."
            onBlur={() => {
              const n = parseAmount(balance);
              if (n != null) updateAccount(db, account.id, { balance: n });
            }}
          />
        )}
        <Label style={{ marginBottom: 6 }}>Type</Label>
        <Segmented value={account.type} onChange={changeType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        <Label style={{ marginTop: 6, fontSize: 12 }}>Mark credit cards as “Card” so they show in the Cards tab and payoff plan.</Label>
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Body>Hide account</Body>
            <Label>Hidden from totals and the Cards tab; transactions are kept.</Label>
          </View>
          <Switch value={!!account.hidden} onValueChange={(v) => updateAccount(db, account.id, { hidden: v ? 1 : 0 })} />
        </Row>
      </Card>
      {account.type === 'credit' && (
        <Button title="Card details & payments" variant="secondary" icon="card" onPress={() => router.push({ pathname: '/card/[id]', params: { id: account.id } })} />
      )}
      <Button
        title="Delete account"
        variant="danger"
        onPress={() =>
          Alert.alert(
            'Delete account?',
            account.source === 'simplefin'
              ? 'It will come back on the next sync. Hide it instead to keep it out of the way.'
              : 'Its transactions and payments will be deleted too.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAccount(db, account.id); router.back(); } },
            ],
          )
        }
      />
    </Screen>
  );
}
