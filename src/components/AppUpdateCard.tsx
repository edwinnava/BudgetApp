import { useState } from 'react';
import { Alert } from 'react-native';
import * as Updates from 'expo-updates';
import { Button, Card, Label, Title } from './ui';

/** Shows which version is running and lets you apply a new over-the-air update right away. */
export function AppUpdateCard() {
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('Up to date', 'You have the latest version.');
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'Restart the app now to use it?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (e) {
      Alert.alert('Could not check for updates', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const version = Updates.isEmbeddedLaunch
    ? 'Built-in version'
    : `Update from ${Updates.createdAt ? Updates.createdAt.toLocaleString() : 'unknown date'}`;

  return (
    <Card>
      <Title>App updates</Title>
      <Label style={{ marginBottom: 10 }}>
        {Updates.isEnabled ? version : 'Updates are off in development builds.'} New versions download automatically when
        the app opens and apply the next time you open it.
      </Label>
      {Updates.isEnabled && <Button title="Check for update now" variant="secondary" icon="cloud-download" loading={busy} onPress={check} />}
    </Card>
  );
}
