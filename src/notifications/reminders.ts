import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, listRecurring, setSetting } from '../db/repo';
import { loadCardPlan } from '../db/cardPlan';
import { DEFAULT_REMINDER_SETTINGS, planReminders, ReminderSettings } from '../lib/reminders';

const SETTINGS_KEY = 'reminders';
const CHANNEL_ID = 'due-dates';
const supported = Platform.OS !== 'web';

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function loadReminderSettings(db: SQLiteDatabase): Promise<ReminderSettings> {
  const raw = await getSetting(db, SETTINGS_KEY);
  return { ...DEFAULT_REMINDER_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
}

export async function saveReminderSettings(db: SQLiteDatabase, s: ReminderSettings): Promise<void> {
  await setSetting(db, SETTINGS_KEY, JSON.stringify(s));
}

/** Asks for notification permission (and creates the Android channel). Returns whether it was granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Due date reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

let lastSignature = '';

/**
 * Replaces all scheduled reminders with a fresh plan. Cheap to call often: it skips the OS
 * calls when the plan hasn't changed since the last run.
 */
export async function rescheduleReminders(db: SQLiteDatabase): Promise<number> {
  if (!supported) return 0;
  const settings = await loadReminderSettings(db);
  let planned: ReturnType<typeof planReminders> = [];
  if (settings.enabled && (await Notifications.getPermissionsAsync()).granted) {
    const [{ cards, paidThisCycle, plan }, bills] = await Promise.all([loadCardPlan(db), listRecurring(db)]);
    planned = planReminders({
      settings,
      bills,
      cards: cards.map((k) => ({
        id: k.id,
        name: k.name,
        owed: k.owed,
        dueDay: k.due_day,
        statementBalance: k.statement_balance,
        paidThisCycle: paidThisCycle.get(k.id) ?? 0,
        minPayment: k.min_payment,
        suggestedPayment: plan.allocations.find((a) => a.id === k.id)?.total ?? null,
      })),
    });
  }
  const signature = JSON.stringify(planned.map((p) => [p.key, p.date.getTime(), p.title, p.body]));
  if (signature === lastSignature) return planned.length;
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.key,
      content: { title: p.title, body: p.body, data: { url: p.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.date, channelId: CHANNEL_ID },
    });
  }
  lastSignature = signature;
  return planned.length;
}

export async function sendTestReminder(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Reminders are on', body: 'You will get payment due reminders like this one.', data: { url: '/cards' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL_ID },
  });
}
