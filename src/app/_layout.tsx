import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { migrate } from '../db/schema';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <SQLiteProvider databaseName="budget.db" onInit={migrate}>
          <Stack screenOptions={{ headerBackTitle: 'Back' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction' }} />
            <Stack.Screen name="transaction/new" options={{ title: 'Add Transaction', presentation: 'modal' }} />
            <Stack.Screen name="recurring/edit" options={{ title: 'Recurring Bill', presentation: 'modal' }} />
            <Stack.Screen name="recurring/discover" options={{ title: 'Found Recurring Charges' }} />
            <Stack.Screen name="card/[id]" options={{ title: 'Credit Card' }} />
            <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
            <Stack.Screen name="account/new" options={{ title: 'Add Account', presentation: 'modal' }} />
            <Stack.Screen name="settings" options={{ title: 'Accounts & Settings' }} />
            <Stack.Screen name="import" options={{ title: 'Import CSV' }} />
          </Stack>
          <StatusBar style="auto" />
        </SQLiteProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
