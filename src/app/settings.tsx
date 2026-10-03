import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../db/hooks';
import { getSetting, listAccounts, resetAllData } from '../db/repo';
import { connectSimpleFin, disconnectSimpleFin } from '../sync/ingest';
import { useSync } from '../sync/useSync';
import { notifyChange } from '../db/events';
import { loadDemoData } from '../db/demo';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import { Body, Button, Card, Divider, Field, Label, ListItem, Money, Screen, Title } from '../components/ui';
import { useColors } from '../components/theme';

export default function Settings() {
  const c = useColors();
  const db = useSQLiteContext();
  const { syncing, sync, connected } = useSync();
  const { data } = useQuery(async (d) => ({ accounts: await listAccounts(d), lastSync: await getSetting(d, 'last_sync_at') }));
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      await connectSimpleFin(token);
      setToken('');
      notifyChange();
      await sync();
    } catch (e) {
      Alert.alert('Could not connect', e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Title>Bank connection (SimpleFIN)</Title>
        {connected ? (
          <>
            <Body>Connected ✓</Body>
            <Label style={{ marginBottom: 10 }}>
              {data?.lastSync ? `Last synced ${new Date(data.lastSync).toLocaleString()}` : 'Not synced yet'}. SimpleFIN refreshes
              about once a day; syncing more often won’t show newer data.
            </Label>
            <Button title="Sync now" icon="sync" loading={syncing} onPress={sync} />
            <Button
              title="Disconnect"
              variant="ghost"
              onPress={() =>
                Alert.alert('Disconnect SimpleFIN?', 'Your synced history stays on this device.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Disconnect', style: 'destructive', onPress: async () => { await disconnectSimpleFin(); notifyChange(); } },
                ])
              }
            />
          </>
        ) : (
          <>
            <Label style={{ marginBottom: 10 }}>
              SimpleFIN Bridge connects to 16,000+ banks and card issuers and lets this app read balances and transactions
              directly — no server in between. Connect your institutions on the SimpleFIN site, create a setup token, and paste it below.
            </Label>
            <Button
              title="Open SimpleFIN Bridge"
              variant="secondary"
              icon="open-outline"
              onPress={() => Linking.openURL('https://beta-bridge.simplefin.org')}
              style={{ marginBottom: 12 }}
            />
            <Field
              label="Setup token"
              value={token}
              onChangeText={setToken}
              placeholder="Paste setup token"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <Button title="Connect" loading={connecting} disabled={!token.trim()} onPress={connect} />
            <Label style={{ marginTop: 8, fontSize: 12 }}>The access key is stored in the device keychain/keystore.</Label>
          </>
        )}
      </Card>

      <Card>
        <Title right={<Button title="Add" variant="ghost" onPress={() => router.push('/account/new')} />}>Accounts</Title>
        {data?.accounts.length === 0 && <Label>No accounts yet.</Label>}
        {data?.accounts.map((a, i) => (
          <View key={a.id}>
            {i > 0 && <Divider />}
            <ListItem
              icon={a.type === 'credit' ? 'card' : a.type === 'savings' ? 'cash' : a.type === 'investment' ? 'trending-up' : 'wallet'}
              iconColor={a.hidden ? c.muted : undefined}
              title={a.name}
              subtitle={[a.institution, a.type, a.source === 'manual' ? 'manual' : null, a.hidden ? 'hidden' : null].filter(Boolean).join(' · ')}
              right={<Money amount={a.balance} />}
              onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.id } })}
            />
          </View>
        ))}
      </Card>

      <ReminderSettingsCard />

      <Card>
        <Title>Import</Title>
        <Label style={{ marginBottom: 10 }}>Most banks let you download transactions as CSV. Import them into any account.</Label>
        <Button title="Import CSV file" icon="document-text" variant="secondary" onPress={() => router.push('/import')} />
      </Card>

      <Card>
        <Title>Data</Title>
        <Label style={{ marginBottom: 10 }}>Everything is stored only on this device in a local database.</Label>
        {data?.accounts.length === 0 && (
          <Button title="Load demo data" icon="flask" variant="secondary" style={{ marginBottom: 10 }} onPress={() => loadDemoData(db)} />
        )}
        <Button
          title="Erase all data"
          variant="danger"
          onPress={() =>
            Alert.alert('Erase everything?', 'Deletes all accounts, transactions, bills, budgets and card data on this device.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Erase', style: 'destructive', onPress: async () => { await disconnectSimpleFin(); await resetAllData(db); } },
            ])
          }
        />
      </Card>
    </Screen>
  );
}
