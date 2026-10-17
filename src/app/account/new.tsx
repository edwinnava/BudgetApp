import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ACCOUNT_TYPES, AccountType, createManualAccount, saveCardDetails } from '../../db/repo';
import { Button, Card, Field, Label, Row, Screen, Segmented, Title } from '../../components/ui';
import { parseAmount } from '../../lib/money';

const TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Card', loan: 'Loan', investment: 'Invest',
};

/** Optional money field: blank -> null, otherwise must parse. */
const optAmount = (s: string): number | null | undefined => (s.trim() ? (parseAmount(s) ?? undefined) : null);
/** Optional day-of-month field: blank -> null, otherwise 1-31. */
const optDay = (s: string): number | null | undefined => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
};

export default function NewAccount() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ type?: AccountType }>();
  const [type, setType] = useState<AccountType>(params.type ?? 'checking');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [balance, setBalance] = useState('');
  const [statement, setStatement] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [minPayment, setMinPayment] = useState('');
  const [apr, setApr] = useState('');
  const [limit, setLimit] = useState('');
  const owes = type === 'credit' || type === 'loan';
  const isCard = type === 'credit';

  const save = async () => {
    if (!name.trim()) return Alert.alert('Enter a name');
    const b = parseAmount(balance || '0');
    if (b == null) return Alert.alert('Balance must be a number');
    const details = {
      statement_balance: optAmount(statement),
      statement_day: optDay(statementDay),
      due_day: optDay(dueDay),
      min_payment: optAmount(minPayment),
      apr: optAmount(apr),
      credit_limit: optAmount(limit),
    };
    if (isCard) {
      const bad = Object.entries(details).find(([, v]) => v === undefined);
      if (bad) {
        const label: Record<string, string> = {
          statement_balance: 'Statement balance', statement_day: 'Statement closes (day)', due_day: 'Payment due (day)',
          min_payment: 'Minimum payment', apr: 'APR', credit_limit: 'Credit limit',
        };
        return Alert.alert(`Check “${label[bad[0]]}”`, bad[0].endsWith('_day') ? 'Use a day of the month from 1 to 31.' : 'Enter a number.');
      }
    }
    const id = await createManualAccount(db, {
      name: name.trim(),
      institution: institution.trim(),
      type,
      balance: owes ? -Math.abs(b) : b,
    });
    if (isCard) {
      await saveCardDetails(db, {
        account_id: id,
        statement_balance: details.statement_balance as number | null,
        statement_day: details.statement_day as number | null,
        due_day: details.due_day as number | null,
        min_payment: details.min_payment as number | null,
        apr: details.apr as number | null,
        credit_limit: details.credit_limit as number | null,
      });
      router.replace({ pathname: '/card/[id]', params: { id } });
    } else router.back();
  };

  return (
    <Screen>
      <Segmented value={type} onChange={setType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder={isCard ? 'e.g. Venture X' : 'e.g. Everyday Checking'} />
        <Field label="Institution" value={institution} onChangeText={setInstitution} placeholder={isCard ? 'e.g. Capital One' : 'Optional'} />
        <Field
          label={owes ? 'Current balance owed' : 'Current balance'}
          value={balance}
          onChangeText={setBalance}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
      </Card>

      {isCard && (
        <Card>
          <Title>Statement & payment</Title>
          <Label style={{ marginBottom: 10, fontSize: 12 }}>All on your latest statement or in the card’s app. You can leave any blank and fill it in later.</Label>
          <Field label="Statement balance" value={statement} onChangeText={setStatement} keyboardType="decimal-pad" placeholder="0.00" />
          <Row style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Statement closes (day)" value={statementDay} onChangeText={setStatementDay} keyboardType="number-pad" placeholder="1-31" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Payment due (day)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" placeholder="1-31" />
            </View>
          </Row>
          <Row style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Minimum payment" value={minPayment} onChangeText={setMinPayment} keyboardType="decimal-pad" placeholder="0.00" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="APR %" value={apr} onChangeText={setApr} keyboardType="decimal-pad" placeholder="e.g. 24.99" />
            </View>
          </Row>
          <Field label="Credit limit" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="Optional" />
        </Card>
      )}

      <Label>
        {isCard
          ? 'Manual cards work everywhere: Cards, Payday, payoff plan and due date reminders. Update the balance on the card’s screen, and logged payments lower it automatically.'
          : 'Manual accounts are updated by you (or by importing a CSV).'}
      </Label>
      <Button title={isCard ? 'Add card' : 'Add account'} onPress={save} />
    </Screen>
  );
}
