import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { useColors } from '../../components/theme';
import { IconButton } from '../../components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} size={size} color={color as string} />,
});

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        headerRight: () => (
          <IconButton icon="settings-outline" onPress={() => router.push('/settings')} />
        ),
        headerRightContainerStyle: { paddingRight: 12 },
      }}
    >
      <Tabs.Screen name="index" options={tab('Overview', 'home')} />
      <Tabs.Screen name="transactions" options={tab('Spending', 'receipt')} />
      <Tabs.Screen name="recurring" options={tab('Recurring', 'repeat')} />
      <Tabs.Screen name="budget" options={tab('Budget', 'pie-chart')} />
      <Tabs.Screen name="cards" options={tab('Cards', 'card')} />
    </Tabs>
  );
}
