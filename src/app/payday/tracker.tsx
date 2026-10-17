import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '../../db/hooks';
import { deletePaydaySnapshot, listPaydaySnapshots } from '../../db/repo';
import { Button, Card, Divider, Empty, Row, Screen } from '../../components/ui';
import { useColors, Colors } from '../../components/theme';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { trackerStats } from '../../lib/payday';

const signed = (n: number) => `${n < 0 ? '-' : '+'}${formatMoney(Math.abs(n))}`;

export default function PaydayTracker() {
  const c = useColors();
  const db = useSQLiteContext();
  const { data: history } = useQuery(listPaydaySnapshots);
  if (!history) return <Screen>{null}</Screen>;

  const stats = trackerStats(history);
  if (!stats) {
    return (
      <Screen>
        <Empty icon="stats-chart" title="No snapshots yet" message="Run a calculation on the Payday tab and tap “Save this payday snapshot”." />
      </Screen>
    );
  }

  const remove = (id: number) =>
    Alert.alert('Delete this snapshot?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePaydaySnapshot(db, id) },
    ]);

  return (
    <Screen>
      <Label c={c}>Overview</Label>
      <View style={styles.grid}>
        <Stat c={c} label="Current total debt" value={formatMoney(stats.totalDebtNow)} color={c.red} />
        <Stat c={c} label="Total paid ever" value={formatMoney(stats.totalPaidEver)} color={c.green} />
        <Stat c={c} label="Debt since start" value={signed(stats.changeSinceStart)} color={stats.changeSinceStart < 0 ? c.green : c.red} />
        <Stat
          c={c}
          label="vs last payday"
          value={stats.changeSinceLast == null ? '—' : signed(stats.changeSinceLast)}
          color={stats.changeSinceLast == null ? c.text : stats.changeSinceLast < 0 ? c.green : c.red}
        />
      </View>

      <Label c={c}>Card balances</Label>
      {stats.cards.map((k) => {
        const changeText =
          k.change == null ? 'First entry' : Math.abs(k.change) < 0.01 ? 'No change' : `${signed(k.change)} vs last`;
        const changeColor = k.change == null || Math.abs(k.change) < 0.01 ? c.muted : k.change < 0 ? c.green : c.red;
        const barColor = k.pctPaid > 60 ? c.green : k.pctPaid > 30 ? c.amber : c.red;
        return (
          <Card key={k.id}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{k.name}</Text>
                <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  Total paid: {formatMoney(k.totalPaid)} · APR {k.apr}%
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{formatMoney(k.balance)}</Text>
                <Text style={{ color: changeColor, fontSize: 11, marginTop: 2 }}>{changeText}</Text>
              </View>
            </Row>
            <View style={[styles.barWrap, { backgroundColor: c.track }]}>
              <View style={[styles.bar, { width: `${k.pctPaid}%`, backgroundColor: barColor }]} />
            </View>
          </Card>
        );
      })}

      <Label c={c}>Payday history</Label>
      <Card>
        {history.map((h, i) => {
          const paid = h.cards.reduce((s, x) => s + x.payment, 0);
          const debt = h.cards.reduce((s, x) => s + x.newBalance, 0);
          return (
            <View key={h.id ?? i}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 10 }}>
                <View>
                  <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>
                    {formatDate(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>Debt after: {formatMoney(debt)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: c.amber, fontSize: 14, fontWeight: '700' }}>-{formatMoney(paid)}</Text>
                  {h.id != null && <Button title="delete" variant="ghost" onPress={() => remove(h.id!)} style={{ paddingVertical: 2, paddingHorizontal: 0 }} />}
                </View>
              </Row>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function Label({ children, c }: { children: string; c: Colors }) {
  return <Text style={[styles.label, { color: c.muted }]}>{children}</Text>;
}

function Stat({ label, value, color, c }: { label: string; value: string; color: string; c: Colors }) {
  return (
    <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontSize: 20, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, borderRadius: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  barWrap: { height: 4, borderRadius: 2, marginTop: 10 },
  bar: { height: 4, borderRadius: 2 },
});
