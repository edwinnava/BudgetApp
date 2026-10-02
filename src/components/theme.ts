import { useColorScheme } from 'react-native';

const light = {
  bg: '#f4f5f7',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  primary: '#4f46e5',
  primaryText: '#ffffff',
  positive: '#16a34a',
  negative: '#dc2626',
  warning: '#d97706',
  track: '#e5e7eb',
  input: '#f9fafb',
};

const dark: typeof light = {
  bg: '#0b0d12',
  card: '#161a22',
  text: '#f3f4f6',
  muted: '#9ca3af',
  border: '#262b36',
  primary: '#818cf8',
  primaryText: '#0b0d12',
  positive: '#4ade80',
  negative: '#f87171',
  warning: '#fbbf24',
  track: '#262b36',
  input: '#0f1218',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
