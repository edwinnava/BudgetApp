import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import { subscribe } from '../db/events';
import { rescheduleReminders } from './reminders';

const useLastResponse = Platform.OS === 'web' ? () => null : Notifications.useLastNotificationResponse;

/**
 * Keeps scheduled reminders in sync with the data (after syncs, payments, edits) and opens
 * the relevant screen when a reminder is tapped. Renders nothing.
 */
export function ReminderSync() {
  const db = useSQLiteContext();
  const response = useLastResponse();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rescheduleReminders(db).catch(() => {}), 1500);
    };
    schedule();
    const unsubscribe = subscribe(schedule);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [db]);

  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === 'string') router.push(url as never);
  }, [response]);

  return null;
}
