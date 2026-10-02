import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import {
  addCardPayment, deletePaymentForTransaction, deleteTransaction, getPaymentForTransaction, getTransaction, listCards,
  setTransactionCategory, setTransactionNotes, Category,
} from '../../db/repo';
import { Body, Button, Card, Divider, Field, IconName, Label, ListItem, Money, Row, Screen } from '../../components/ui';
import { AccountPicker, CategoryPicker } from '../../components/pickers';
import { useColors } from '../../components/theme';
import { CARD_PAYMENT_CATEGORY } from '../../lib/categorize';
import { formatDate } from '../../lib/dates';

export default function TransactionDetail() {
  const c = useColors();
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = id;
  const { data } = useQuery(async (d) => {
    const [txn, payment, cards] = await Promise.all([getTransaction(d, txnId), getPaymentForTransaction(d, txnId), listCards(d)]);
    return { txn, payment, cards };
  }, [txnId]);
  const [picking, setPicking] = useState(false);
  const [pickingCard, setPickingCard] = useState(false);
  const [remember, setRemember] = useState(true);
  const [notes, setNotes] = useState<string | null>(null);

  if (!data) return <Screen>{null}</Screen>;
  const { txn, payment, cards } = data;
  if (!txn) return <Screen><Label>Transaction not found.</Label></Screen>;

  const pick = async (cat: Category | null) => {
    await setTransactionCategory(db, txn, cat?.id ?? null, remember);
    // A credit on a card categorized as a payment counts toward the payoff tracker.
    if (cat?.name === CARD_PAYMENT_CATEGORY && txn.account_type === 'credit' && txn.amount > 0) {
      await addCardPayment(db, { cardId: txn.account_id, date: txn.date, amount: txn.amount, transactionId: txn.id });
    } else if (cat?.name !== CARD_PAYMENT_CATEGORY && payment) {
      await deletePaymentForTransaction(db, txn.id);
    }
  };

  const isOutgoingCardPayment = txn.category_name === CARD_PAYMENT_CATEGORY && txn.account_type !== 'credit' && txn.amount < 0;
  const appliedCard = payment && cards.find((k) => k.id === payment.card_account_id);

  return (
    <Screen>
      <Card>
        <Label>{formatDate(txn.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Label>
        <Body style={{ fontSize: 18, fontWeight: '600', marginVertical: 6 }}>{txn.description}</Body>
        <Money amount={txn.amount} size={30} colored />
        <Label style={{ marginTop: 6 }}>
          {txn.account_name}{txn.pending ? ' · pending' : ''}
        </Label>
      </Card>

      <Card>
        <ListItem
          icon={(txn.category_icon as IconName) ?? 'help-circle'}
          iconColor={txn.category_color ?? c.muted}
          title={txn.category_name ?? 'Uncategorized'}
          subtitle="Tap to change category"
          onPress={() => setPicking(true)}
        />
        <Divider />
        <Row style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
          <View style={{ flex: 1 }}>
            <Body>Apply to all from this merchant</Body>
            <Label>Also categorizes future transactions</Label>
          </View>
          <Switch value={remember} onValueChange={setRemember} />
        </Row>
      </Card>

      {isOutgoingCardPayment && cards.length > 0 && (
        <Card>
          <Body style={{ fontWeight: '600', marginBottom: 4 }}>Credit card payment</Body>
          <Label style={{ marginBottom: 10 }}>
            If the card itself is not synced, link this payment so the payoff tracker counts it.
          </Label>
          {appliedCard ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Body>Applied to {appliedCard.name}</Body>
              <Button title="Unlink" variant="ghost" onPress={() => deletePaymentForTransaction(db, txn.id)} />
            </Row>
          ) : (
            <Button title="Apply to a card" variant="secondary" icon="card" onPress={() => setPickingCard(true)} />
          )}
        </Card>
      )}

      <Card>
        <Field
          label="Notes"
          value={notes ?? txn.notes}
          onChangeText={setNotes}
          onBlur={() => notes != null && setTransactionNotes(db, txn.id, notes)}
          placeholder="Add a note"
          multiline
        />
      </Card>

      {txn.id.startsWith('manual:') || txn.id.startsWith('csv:') ? (
        <Button
          title="Delete transaction"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete transaction?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await deleteTransaction(db, txn.id); router.back(); } },
            ])
          }
        />
      ) : null}

      <CategoryPicker visible={picking} onClose={() => setPicking(false)} onPick={pick} allowNone />
      <AccountPicker
        visible={pickingCard}
        onClose={() => setPickingCard(false)}
        filter={(a) => a.type === 'credit'}
        onPick={(a) => addCardPayment(db, { cardId: a.id, date: txn.date, amount: -txn.amount, transactionId: txn.id })}
      />
    </Screen>
  );
}
