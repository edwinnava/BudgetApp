import React, { ReactNode, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle, StyleProp, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from './theme';
import { formatMoney } from '../lib/money';

export type IconName = keyof typeof Ionicons.glyphMap;

export function Screen({
  children, refreshing, onRefresh, padded = true,
}: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean }) {
  const c = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={padded ? styles.screen : { paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useColors();
  const body = <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable> : body;
}

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.titleRow}>
      <Text style={[styles.title, { color: c.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: object }) {
  const c = useColors();
  return <Text style={[{ color: c.muted, fontSize: 13 }, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: ReactNode; style?: object; numberOfLines?: number }) {
  const c = useColors();
  return <Text numberOfLines={numberOfLines} style={[{ color: c.text, fontSize: 15 }, style]}>{children}</Text>;
}

export function Money({
  amount, size = 15, colored = false, sign = false, style, cents = true,
}: { amount: number; size?: number; colored?: boolean; sign?: boolean; style?: object; cents?: boolean }) {
  const c = useColors();
  const color = colored ? (amount > 0 ? c.positive : amount < 0 ? c.text : c.muted) : c.text;
  return (
    <Text style={[{ color, fontSize: size, fontWeight: size > 18 ? '700' : '600', fontVariant: ['tabular-nums'] }, style]}>
      {formatMoney(amount, { sign, cents })}
    </Text>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function ListItem({
  icon, iconColor, title, subtitle, right, rightSub, onPress,
}: {
  icon?: IconName; iconColor?: string; title: string; subtitle?: string; right?: ReactNode; rightSub?: string; onPress?: () => void;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listItem, { opacity: pressed ? 0.6 : 1 }]}>
      {icon && (
        <View style={[styles.iconBubble, { backgroundColor: (iconColor ?? c.primary) + '22' }]}>
          <Ionicons name={icon} size={18} color={iconColor ?? c.primary} />
        </View>
      )}
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {!!subtitle && <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {right}
        {!!rightSub && <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{rightSub}</Text>}
      </View>
    </Pressable>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 2 }} />;
}

export function Button({
  title, onPress, variant = 'primary', icon, loading, disabled, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.negative : variant === 'secondary' ? c.card : 'transparent';
  const fg = variant === 'primary' ? c.primaryText : variant === 'danger' ? '#fff' : c.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: c.border },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 6 }} />}
          <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color }: { icon: IconName; onPress: () => void; color?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}>
      <Ionicons name={icon} size={22} color={color ?? c.primary} />
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Label style={{ marginBottom: 4 }}>{label}</Label>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: c.border }, props.style]}
      />
      {!!hint && <Label style={{ marginTop: 4, fontSize: 12 }}>{hint}</Label>}
    </View>
  );
}

export function ProgressBar({
  value, max, color, height = 8, overColor,
}: { value: number; max: number; color?: string; height?: number; overColor?: string }) {
  const c = useColors();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const over = max > 0 && value > max;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, backgroundColor: over ? (overColor ?? c.negative) : (color ?? c.primary), borderRadius: height / 2 }} />
    </View>
  );
}

export function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.track }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: c.card }]}
          >
            <Text numberOfLines={1} style={{ color: active ? c.text : c.muted, fontWeight: active ? '600' : '400', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ icon = 'sparkles', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 }}>
      <Ionicons name={icon} size={36} color={c.muted} />
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600', marginTop: 10, textAlign: 'center' }}>{title}</Text>
      {!!message && <Text style={{ color: c.muted, fontSize: 14, marginTop: 6, textAlign: 'center' }}>{message}</Text>}
      {action && <View style={{ marginTop: 14 }}>{action}</View>}
    </View>
  );
}

export function Stat({ label, amount, sub, color }: { label: string; amount: number; sub?: string; color?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Label>{label}</Label>
      <Money amount={amount} size={22} style={color ? { color } : undefined} cents={false} />
      {!!sub && <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

/** Bottom-sheet style picker for choosing one item from a list. */
export function PickerModal<T>({
  visible, onClose, title, items, keyOf, render, onPick,
}: {
  visible: boolean; onClose: () => void; title: string; items: T[];
  keyOf: (t: T) => string; render: (t: T) => ReactNode; onPick: (t: T) => void;
}) {
  const c = useColors();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <IconButton icon="close" onPress={onClose} color={c.muted} />
        </Row>
        <FlatList
          data={items}
          keyExtractor={keyOf}
          ItemSeparatorComponent={Divider}
          renderItem={({ item }) => (
            <Pressable onPress={() => { onPick(item); onClose(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              {render(item)}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

/** Inline numeric prompt (Alert.prompt is iOS-only, so this works on both platforms). */
export function PromptModal({
  visible, title, message, initial = '', placeholder, keyboardType = 'decimal-pad', onSubmit, onClose,
}: {
  visible: boolean; title: string; message?: string; initial?: string; placeholder?: string;
  keyboardType?: TextInputProps['keyboardType']; onSubmit: (v: string) => void; onClose: () => void;
}) {
  const c = useColors();
  const [value, setValue] = useState(initial);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setValue(initial)}>
      <View style={styles.center}>
        <View style={[styles.dialog, { backgroundColor: c.card }]}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>{title}</Text>
          {!!message && <Label style={{ marginBottom: 10 }}>{message}</Label>}
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            keyboardType={keyboardType}
            style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: c.border }]}
          />
          <Row style={{ justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <Button title="Cancel" variant="ghost" onPress={onClose} />
            <Button title="Save" onPress={() => { onSubmit(value); onClose(); }} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  iconBubble: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 32 },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 16, padding: 18 },
});
