import { useCallback, useEffect, useRef, useState } from 'react';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { subscribe } from './events';

/**
 * Runs an async query against the local DB and re-runs it when the screen gains focus,
 * when `deps` change, or when any write happens elsewhere in the app.
 */
export function useQuery<T>(fn: (db: SQLiteDatabase) => Promise<T>, deps: unknown[] = []) {
  const db = useSQLiteContext();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    fnRef
      .current(db)
      .then((d) => id === seq.current && (setData(d), setError(null)))
      .catch((e) => id === seq.current && setError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ...deps]);

  useEffect(() => {
    run();
    return subscribe(run);
  }, [run]);
  useFocusEffect(run);

  return { data, error, reload: run };
}
