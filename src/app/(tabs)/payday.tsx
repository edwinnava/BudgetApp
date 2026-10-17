import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import { addPaydaySnapshot, getSetting, listCards, listRecurring, setSettingQuiet, Card as CardRow } from '../../db/repo';
import { Button, Card, Field, IconButton, Label, Row, Screen, Segmented } from '../../components/ui';
import { useColors, Colors } from '../../components/theme';
import { isValidISO, today } from '../../lib/dates';
import { formatMoney, parseAmount } from '../../lib/money';
import { minimumFor } from '../../lib/payoff';
import { ASSUMED_APR, toDebtCard } from '../../lib/cards';
import { upcomingBills } from '../../lib/bills';
import {
  clampPayment, planPayday, redistribute, snapshotCards, summarize, urgencyFor, PaydayCard, PaydayMode, PaydayPayment, Urgency,
} from '../../lib/payday';

const INPUTS_KEY = 'payday_inputs';

interface Inputs {
  paycheck: string;
  payDate: string;
  bills: { name: string; amount: string }[];
  statement: Record<string, string>; // per card id, overrides the synced statement balance
  current: Record<string, string>; // per card id, overrides the synced current balance
  mode: PaydayMode;
}

const emptyInputs = (): Inputs => ({ paycheck: '', payDate: today(), bills: [], statement: {}, current: {}, mode: 'due' });

interface Result {
  paycheck: number;
  totalBills: number;
  pool: number;
  auto: PaydayPayment[];
  payments: PaydayPayment[];
  locked: Set<string>;
}

const num = (s: string | undefined) => (s && s.trim() ? (parseAmount(s) ?? 0) : 0);
const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

async function load(db: Parameters<typeof listCards>[0]) {
  const [cards, bills, raw] = await Promise.all([listCards(db), listRecurring(db), getSetting(db, INPUTS_KEY)]);
  return { cards, bills, saved: raw ? ({ ...emptyInputs(), ...JSON.parse(raw), payDate: today() } as Inputs) : null };
}

export default function Payday() {
  const c = useColors();
  const db = useSQLiteContext();
  const { data } = useQuery(load);
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Restore saved inputs once (pay date resets to today, like the web app).
  if (data && !inputs) setInputs(data.saved ?? { ...emptyInputs(), bills: [{ name: '', amount: '' }] });

  useEffect(() => {
    if (!inputs) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void setSettingQuiet(db, INPUTS_KEY, JSON.stringify(inputs)), 400);
  }, [db, inputs]);

  const cards = useMemo(() => data?.cards ?? [], [data]);
  if (!data || !inputs) return <Screen>{null}</Screen>;

  const update = (patch: Partial<Inputs>) => setInputs({ ...inputs, ...patch });
  const statementFor = (k: CardRow) => inputs.statement[k.id] ?? (k.statement_balance != null ? String(k.statement_balance) : '');
  const currentFor = (k: CardRow) => inputs.current[k.id] ?? String(k.owed);
  const minFor = (k: CardRow) => minimumFor(toDebtCard({ ...k, owed: Math.max(k.owed, num(statementFor(k))) }));

  const setBill = (i: number, patch: Partial<Inputs['bills'][number]>) =>
    update({ bills: inputs.bills.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const importBills = () => {
    const from = isValidISO(inputs.payDate) ? inputs.payDate : today();
    const upcoming = upcomingBills(data.bills, 13, from);
    const have = new Set(inputs.bills.map((b) => b.name.trim().toLowerCase()));
    const add = upcoming.filter((u) => !have.has(u.bill.name.toLowerCase())).map((u) => ({ name: u.bill.name, amount: String(u.bill.amount) }));
    if (!add.length) return Alert.alert('No new bills', 'No other recurring bills are due in the 2 weeks after this pay date.');
    update({ bills: [...inputs.bills.filter((b) => b.name.trim() || b.amount.trim()), ...add] });
  };

  const calculate = (mode: PaydayMode = inputs.mode) => {
    const paycheck = num(inputs.paycheck);
    if (!paycheck) return Alert.alert('Enter your take-home amount');
    const totalBills = inputs.bills.reduce((s, b) => s + num(b.amount), 0);
    const pool = Math.round((paycheck - totalBills) * 100) / 100;
    const from = isValidISO(inputs.payDate) ? inputs.payDate : today();
    const paydayCards: PaydayCard[] = cards.map((k) => ({
      id: k.id,
      name: k.name,
      min: minFor(k),
      dueDay: k.due_day,
      apr: k.apr ?? ASSUMED_APR,
      balance: num(statementFor(k)),
    }));
    const auto = planPayday(paydayCards, pool, mode, from);
    if (!auto.length) return Alert.alert('Enter at least one statement balance');
    setResult({ paycheck, totalBills, pool, auto, payments: auto, locked: new Set() });
  };

  const setMode = (mode: PaydayMode) => {
    update({ mode });
    if (result) calculate(mode);
  };

  const override = (id: string, value: string) => {
    if (!result) return;
    const locked = new Set(result.locked).add(id);
    const payments = result.payments.map((p) => (p.id === id ? { ...p, payment: clampPayment(parseAmount(value) ?? 0, p.balance) } : p));
    setResult({ ...result, locked, payments: redistribute(payments, locked, result.pool, inputs.mode) });
  };

  const toggleLock = (id: string) => {
    if (!result) return;
    const locked = new Set(result.locked);
    if (locked.has(id)) locked.delete(id);
    else locked.add(id);
    setResult({ ...result, locked, payments: redistribute(result.payments, locked, result.pool, inputs.mode) });
  };

  const save = async () => {
    if (!result) return;
    const current = new Map(cards.map((k) => [k.id, currentFor(k).trim() ? num(currentFor(k)) : null]));
    await addPaydaySnapshot(db, {
      date: isValidISO(inputs.payDate) ? inputs.payDate : today(),
      createdAt: Date.now(),
      paycheck: result.paycheck,
      totalBills: Math.round(result.totalBills * 100) / 100,
      cards: snapshotCards(result.payments, current),
    });
    Alert.alert('Saved', 'Payday snapshot saved to the Debt Tracker.');
  };

  const summary = result ? summarize(result.payments, result.pool) : null;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>Split your paycheck across bills and cards.</Label>
        <Button title="Tracker" variant="secondary" icon="stats-chart" onPress={() => router.push('/payday/tracker')} style={{ paddingVertical: 6 }} />
      </Row>

      <Card>
        <SectionLabel>Paycheck</SectionLabel>
        <Field label="Take-home amount" value={inputs.paycheck} onChangeText={(v) => update({ paycheck: v })} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Pay date" value={inputs.payDate} onChangeText={(v) => update({ payDate: v })} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      </Card>

      <Card>
        <SectionLabel>Bills going out</SectionLabel>
        {inputs.bills.map((b, i) => (
          <Row key={i} style={{ gap: 8, marginBottom: 8 }}>
            <TextInput
              style={[styles.input, inputStyle(c), { flex: 1 }]}
              placeholder="Bill name"
              placeholderTextColor={c.muted}
              value={b.name}
              onChangeText={(v) => setBill(i, { name: v })}
            />
            <TextInput
              style={[styles.input, inputStyle(c), { width: 100, textAlign: 'right' }]}
              placeholder="$0.00"
              placeholderTextColor={c.muted}
              keyboardType="decimal-pad"
              value={b.amount}
              onChangeText={(v) => setBill(i, { amount: v })}
            />
            <IconButton icon="close-circle-outline" color={c.muted} onPress={() => update({ bills: inputs.bills.filter((_, j) => j !== i) })} />
          </Row>
        ))}
        <Row style={{ gap: 8 }}>
          <Button title="Add bill" icon="add" variant="secondary" style={{ flex: 1 }} onPress={() => update({ bills: [...inputs.bills, { name: '', amount: '' }] })} />
          <Button title="Upcoming bills" icon="repeat" variant="secondary" style={{ flex: 1 }} onPress={importBills} />
        </Row>
      </Card>

      <Card>
        <SectionLabel>Card statement balances</SectionLabel>
        <Label style={{ marginBottom: 8, fontSize: 12 }}>Filled in from your synced cards. Edit for this payday; leave statement blank if paid off.</Label>
        {cards.length === 0 && <Label>No credit cards yet. Link one in Settings or add it manually below.</Label>}
        {cards.length > 0 && (
          <Row style={{ marginBottom: 4 }}>
            <View style={{ flex: 1 }} />
            <Text style={[styles.colHead, { color: c.muted }]}>Statement</Text>
            <Text style={[styles.colHead, { color: c.muted }]}>Current</Text>
          </Row>
        )}
        {cards.map((k) => (
          <Row key={k.id} style={{ gap: 6, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{k.name}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>
                Min {formatMoney(minFor(k), { cents: false })}
                {k.due_day ? ` · Due ${ord(k.due_day)}` : ' · Due day not set'}
                {k.apr == null ? ' · APR?' : ` · ${k.apr}%`}
              </Text>
            </View>
            <TextInput
              style={[styles.input, inputStyle(c), styles.cardInput]}
              placeholder="$0.00"
              placeholderTextColor={c.muted}
              keyboardType="decimal-pad"
              value={statementFor(k)}
              onChangeText={(v) => update({ statement: { ...inputs.statement, [k.id]: v } })}
            />
            <TextInput
              style={[styles.input, inputStyle(c), styles.cardInput, { borderColor: c.amber }]}
              placeholder="$0.00"
              placeholderTextColor={c.muted}
              keyboardType="decimal-pad"
              value={currentFor(k)}
              onChangeText={(v) => update({ current: { ...inputs.current, [k.id]: v } })}
            />
          </Row>
        ))}
        <Button
          title="Add a card manually"
          icon="add"
          variant="secondary"
          style={{ marginTop: 4 }}
          onPress={() => router.push({ pathname: '/account/new', params: { type: 'credit' } })}
        />
        {(Object.keys(inputs.statement).length > 0 || Object.keys(inputs.current).length > 0) && (
          <Button title="Use synced balances" variant="ghost" onPress={() => update({ statement: {}, current: {} })} />
        )}
      </Card>

      <Pressable onPress={() => calculate()} style={({ pressed }) => [styles.calcBtn, { backgroundColor: pressed ? '#0F6E56' : c.green }]}>
        <Text style={styles.calcText}>Calculate payday split</Text>
      </Pressable>

      {result && summary && (
        <>
          <SectionLabel>Summary</SectionLabel>
          <View style={styles.sumGrid}>
            <SumCard label="Paycheck" value={formatMoney(result.paycheck)} c={c} />
            <SumCard label="Bills out" value={formatMoney(-result.totalBills)} color={c.red} c={c} />
            <SumCard label="To debt" value={formatMoney(summary.totalPaying)} color={c.amber} c={c} />
            <SumCard label="True leftover" value={formatMoney(summary.leftover)} color={summary.leftover >= 0 ? c.green : c.red} c={c} />
          </View>

          <SectionLabel>Payment dashboard</SectionLabel>
          <Label style={{ fontSize: 12, marginTop: -6 }}>Edit any payment — other cards auto-adjust with the remaining budget.</Label>
          <Segmented
            value={inputs.mode}
            onChange={setMode}
            options={[
              { value: 'due', label: 'Avoid late fees' },
              { value: 'apr', label: 'Minimize interest' },
            ]}
          />
          <Label style={{ fontSize: 11, textAlign: 'center', marginTop: -6 }}>
            {inputs.mode === 'due' ? 'Soonest due first' : 'Highest APR first'}
          </Label>

          <Banner leftover={summary.leftover} c={c} />

          {result.payments.map((p) => (
            <PaymentCard key={p.id} p={p} locked={result.locked.has(p.id)} c={c} onChange={(v) => override(p.id, v)} onToggleLock={() => toggleLock(p.id)} />
          ))}

          <Button
            title="Reset to auto-calculated payments"
            variant="secondary"
            onPress={() => setResult({ ...result, payments: result.auto, locked: new Set() })}
          />
          <Pressable onPress={save} style={({ pressed }) => [styles.calcBtn, { backgroundColor: pressed ? '#C07B10' : c.amber }]}>
            <Text style={styles.calcText}>Save this payday snapshot</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const inputStyle = (c: Colors) => ({ backgroundColor: c.input, color: c.text, borderColor: c.border });

function SectionLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[styles.sectionLabel, { color: c.muted }]}>{children}</Text>;
}

function SumCard({ label, value, color, c }: { label: string; value: string; color?: string; c: Colors }) {
  return (
    <View style={[styles.sumCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: color ?? c.text, fontSize: 18, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function Banner({ leftover, c }: { leftover: number; c: Colors }) {
  const [bg, fg, text] =
    leftover > 0.009
      ? [c.greenBg, c.greenText, `${formatMoney(leftover)} unallocated — assign it below`]
      : leftover < -0.009
        ? [c.redBg, c.redText, `Over budget by ${formatMoney(-leftover)} — reduce a payment`]
        : [c.track, c.muted, 'Fully allocated'];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

function urgencyColors(u: Urgency, c: Colors) {
  switch (u) {
    case 'urgent':
      return { bg: c.redBg, border: c.red, fg: c.redText, accent: c.red };
    case 'soon':
      return { bg: c.amberBg, border: c.amber, fg: c.amberText, accent: c.amber };
    case 'later':
      return { bg: c.greenBg, border: c.green, fg: c.greenText, accent: c.green };
    default:
      return { bg: c.card, border: c.border, fg: c.muted, accent: c.muted };
  }
}

function PaymentCard({
  p, locked, c, onChange, onToggleLock,
}: { p: PaydayPayment; locked: boolean; c: Colors; onChange: (v: string) => void; onToggleLock: () => void }) {
  const u = urgencyColors(urgencyFor(p.daysUntil), c);
  const [text, setText] = useState(p.payment.toFixed(2));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : p.payment.toFixed(2);
  const newBalance = Math.max(0, Math.round((p.balance - p.payment) * 100) / 100);
  const pct = p.balance > 0 ? Math.min(100, Math.round((p.payment / p.balance) * 100)) : 0;
  const belowMin = p.payment < Math.min(p.min, p.balance) - 0.009;

  return (
    <View style={[styles.dc, { backgroundColor: u.bg, borderColor: u.border }]}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <Text numberOfLines={1} style={{ color: u.fg, fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 }}>{p.name}</Text>
        <View style={[styles.chip, { backgroundColor: u.accent }]}>
          <Text style={styles.chipText}>{p.daysUntil == null ? 'no due date' : `${p.daysUntil}d`} · {p.apr}%</Text>
        </View>
      </Row>
      <Row style={{ alignItems: 'flex-end', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.flbl, { color: u.fg }]}>Payment</Text>
          <TextInput
            style={[styles.payInput, { color: u.fg, backgroundColor: u.accent + '1F', borderColor: u.accent + '55' }]}
            keyboardType="decimal-pad"
            value={shown}
            onFocus={() => {
              setText(p.payment.toFixed(2));
              setFocused(true);
            }}
            onChangeText={setText}
            returnKeyType="done"
            onBlur={() => {
              setFocused(false);
              if (text !== p.payment.toFixed(2)) onChange(text);
            }}
          />
          <Pressable onPress={onToggleLock} style={[styles.lockBtn, locked ? { backgroundColor: c.amber, borderColor: c.amber } : { borderColor: c.border }]}>
            <Text style={{ fontSize: 11, color: locked ? '#fff' : c.muted }}>{locked ? '🔒 Locked' : '🔓 Auto'}</Text>
          </Pressable>
          {belowMin && <Text style={{ fontSize: 10, color: c.redText, marginTop: 4 }}>Below {formatMoney(p.min)} minimum</Text>}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={[styles.flbl, { color: u.fg }]}>New balance</Text>
          <Text style={{ color: u.fg, fontSize: 16, fontWeight: '700' }}>{formatMoney(newBalance)}</Text>
          <Text style={{ color: u.fg, opacity: 0.7, fontSize: 10, marginTop: 2 }}>was {formatMoney(p.balance)}</Text>
        </View>
      </Row>
      <View style={[styles.barWrap, { backgroundColor: c.text + '14' }]}>
        <View style={[styles.bar, { width: `${pct}%`, backgroundColor: u.accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  cardInput: { width: 92, textAlign: 'right', paddingHorizontal: 8 },
  colHead: { width: 92, textAlign: 'center', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 6 },
  calcBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  calcText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumCard: { flexBasis: '48%', flexGrow: 1, borderRadius: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  banner: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  dc: { borderRadius: 10, padding: 14, borderWidth: 1 },
  chip: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  flbl: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3, opacity: 0.8 },
  payInput: { fontSize: 16, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, textAlign: 'right' },
  lockBtn: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  barWrap: { height: 3, borderRadius: 2, marginTop: 10 },
  bar: { height: 3, borderRadius: 2 },
});
