import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../db/hooks';
import { getPlaidServer, listPlaidItems, openPlaidLink, PlaidItem, removePlaidItem, savePlaidServer, syncPlaid } from '../sync/plaid';
import { Body, Button, Card, Divider, Field, Label, ListItem, Row, Title } from './ui';
import { useColors } from './theme';

export function PlaidSettingsCard() {
  const c = useColors();
  const db = useSQLiteContext();
  const { data } = useQuery(async (d) => ({ server: await getPlaidServer(), items: await listPlaidItems(d) }));
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState(false);
  if (!data) return null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Plaid', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const link = (item?: PlaidItem) =>
    run(item ? `reconnect:${item.item_id}` : 'link', async () => {
      if (!(await openPlaidLink(db, item))) return;
      const r = await syncPlaid(db);
      if (r.errors.length) Alert.alert('Linked, but sync had problems', r.errors.join('\n'));
      // Right after linking, Plaid is still pulling history; fetch again shortly.
      setTimeout(() => void syncPlaid(db).catch(() => {}), 30_000);
    });

  const remove = (item: PlaidItem) =>
    Alert.alert(`Remove ${item.institution}?`, 'Stops syncing this login and revokes access at Plaid.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep history', onPress: () => run('remove', () => removePlaidItem(db, item, false)) },
      { text: 'Delete accounts too', style: 'destructive', onPress: () => run('remove', () => removePlaidItem(db, item, true)) },
    ]);

  const showServerForm = !data.server || editingServer;

  return (
    <Card>
      <Title>Bank connection (Plaid)</Title>
      {showServerForm ? (
        <>
          <Label style={{ marginBottom: 10 }}>
            Enter the address of your Plaid server (the Cloudflare Worker in the server/ folder) and the app secret you gave it.
            See the README for the 10-minute setup.
          </Label>
          <Field label="Server URL" value={url} onChangeText={setUrl} placeholder="https://budgetapp-plaid.you.workers.dev" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Field label="App secret" value={secret} onChangeText={setSecret} placeholder="The APP_SECRET you set" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Row style={{ gap: 10 }}>
            {editingServer && <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditingServer(false)} />}
            <Button
              title="Save"
              style={{ flex: 1 }}
              loading={busy === 'server'}
              disabled={!url.trim() || !secret.trim()}
              onPress={() => run('server', async () => { await savePlaidServer(url, secret); setEditingServer(false); setSecret(''); })}
            />
          </Row>
        </>
      ) : (
        <>
          {data.items.length === 0 && <Label style={{ marginBottom: 10 }}>No banks linked yet.</Label>}
          {data.items.map((item, i) => (
            <View key={item.item_id}>
              {i > 0 && <Divider />}
              <ListItem
                icon={item.error ? 'alert-circle' : 'business'}
                iconColor={item.error ? c.negative : undefined}
                title={item.institution}
                subtitle={
                  item.error
                    ? item.error === 'ITEM_LOGIN_REQUIRED' ? 'Needs you to log in again' : item.error
                    : item.last_sync ? `Synced ${new Date(item.last_sync).toLocaleString()}` : 'Waiting for first sync'
                }
                right={<Button title="Remove" variant="ghost" onPress={() => remove(item)} />}
              />
              {!!item.error && (
                <Button title="Reconnect" variant="secondary" icon="refresh" loading={busy === `reconnect:${item.item_id}`} onPress={() => link(item)} style={{ marginBottom: 8 }} />
              )}
            </View>
          ))}
          <Button title="Link a bank or card" icon="add" loading={busy === 'link'} onPress={() => link()} style={{ marginTop: 6 }} />
          <Body style={{ fontSize: 12, marginTop: 8, color: c.muted }}>
            Card statement balance, minimum payment, due date and APR are filled in automatically when your bank provides them.
            Free Trial plan: up to 10 linked logins.
          </Body>
          <Button title="Change server" variant="ghost" onPress={() => { setUrl(data.server!.url); setEditingServer(true); }} />
        </>
      )}
    </Card>
  );
}
