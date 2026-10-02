import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { isSimpleFinConnected, syncSimpleFin } from './ingest';
import { subscribe } from '../db/events';

export function useSync() {
  const db = useSQLiteContext();
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = () => void isSimpleFinConnected().then(setConnected);
    check();
    return subscribe(check);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await syncSimpleFin(db);
      if (r.errors.length) Alert.alert('Synced with warnings', r.errors.join('\n'));
    } catch (e) {
      Alert.alert('Sync failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [db]);

  return { syncing, sync, connected };
}
