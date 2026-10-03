import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { isSimpleFinConnected, syncSimpleFin } from './ingest';
import { listPlaidItems, syncPlaid } from './plaid';
import { subscribe } from '../db/events';
import { setSetting } from '../db/repo';

/** Syncs every connected source (Plaid logins and SimpleFIN). */
export function useSync() {
  const db = useSQLiteContext();
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = () =>
      void Promise.all([isSimpleFinConnected(), listPlaidItems(db)]).then(([sf, items]) => setConnected(sf || items.length > 0));
    check();
    return subscribe(check);
  }, [db]);

  const sync = useCallback(async () => {
    setSyncing(true);
    const problems: string[] = [];
    try {
      if ((await listPlaidItems(db)).length) problems.push(...(await syncPlaid(db)).errors);
      if (await isSimpleFinConnected()) {
        try {
          problems.push(...(await syncSimpleFin(db)).errors);
        } catch (e) {
          problems.push(`SimpleFIN: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await setSetting(db, 'last_sync_at', new Date().toISOString());
      if (problems.length) Alert.alert('Some accounts did not sync', problems.join('\n\n'));
    } finally {
      setSyncing(false);
    }
  }, [db]);

  return { syncing, sync, connected };
}
