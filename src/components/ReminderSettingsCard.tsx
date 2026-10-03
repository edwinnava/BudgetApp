import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../db/hooks';
import {
  ensureNotificationPermission, loadReminderSettings, rescheduleReminders, saveReminderSettings, sendTestReminder,
} from '../notifications/reminders';
import { ReminderSettings } from '../lib/reminders';
import { Body, Button, Card, Divider, Label, Row, Segmented, Title } from './ui';

const HOURS = [
  { value: '8', label: '8 AM' },
  { value: '9', label: '9 AM' },
  { value: '12', label: 'Noon' },
  { value: '18', label: '6 PM' },
];

export function ReminderSettingsCard() {
  const db = useSQLiteContext();
  const { data: s } = useQuery(loadReminderSettings);
  const [count, setCount] = useState<number | null>(null);
  if (!s) return null;

  const update = async (patch: Partial<ReminderSettings>) => {
    const next = { ...s, ...patch };
    if (patch.enabled && !(await ensureNotificationPermission())) {
      Alert.alert('Notifications are blocked', 'Allow notifications for BudgetApp in your phone settings to get reminders.');
      return;
    }
    await saveReminderSettings(db, next);
    setCount(await rescheduleReminders(db));
  };

  return (
    <Card>
      <Title>Due date reminders</Title>
      <Row style={{ justifyContent: 'space-between', paddingBottom: 8 }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Body>Remind me before payments are due</Body>
          <Label>Card due dates come from each card’s “Payment due” day.</Label>
        </View>
        <Switch value={s.enabled} onValueChange={(v) => update({ enabled: v })} />
      </Row>
      {s.enabled && (
        <>
          <Divider />
          <Label style={{ marginTop: 10, marginBottom: 6 }}>Credit cards: days before the due date (plus on the day)</Label>
          <Segmented
            value={String(s.cardDaysBefore)}
            onChange={(v) => update({ cardDaysBefore: Number(v) })}
            options={['1', '3', '5', '7'].map((d) => ({ value: d, label: `${d} day${d === '1' ? '' : 's'}` }))}
          />
          <Row style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <Body>Recurring bills</Body>
            <Switch value={s.billsEnabled} onValueChange={(v) => update({ billsEnabled: v })} />
          </Row>
          {s.billsEnabled && (
            <View style={{ marginTop: 6 }}>
              <Segmented
                value={String(s.billDaysBefore)}
                onChange={(v) => update({ billDaysBefore: Number(v) })}
                options={[
                  { value: '0', label: 'Same day' },
                  { value: '1', label: '1 day before' },
                  { value: '3', label: '3 days before' },
                ]}
              />
            </View>
          )}
          <Label style={{ marginTop: 14, marginBottom: 6 }}>Time of day</Label>
          <Segmented value={String(s.hour)} onChange={(v) => update({ hour: Number(v) })} options={HOURS} />
          <Label style={{ marginTop: 10, fontSize: 12 }}>
            {count != null ? `${count} reminders scheduled. ` : ''}Reminders update automatically when balances, payments or bills change.
            A card whose statement is already paid in full is skipped for that cycle.
          </Label>
          <Button title="Send a test notification" variant="ghost" onPress={sendTestReminder} />
        </>
      )}
    </Card>
  );
}
