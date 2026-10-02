import { useState } from 'react';
import { FlatList, TextInput, View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '../../db/hooks';
import { listTransactions } from '../../db/repo';
import { Divider, Empty, IconButton, IconName, ListItem, Money, Row } from '../../components/ui';
import { useColors } from '../../components/theme';
import { formatDate, formatMonth, monthKey, shiftMonth, today } from '../../lib/dates';

export default function Transactions() {
  const c = useColors();
  const params = useLocalSearchParams<{ categoryId?: string; month?: string }>();
  const [month, setMonth] = useState(params.month ?? monthKey(today()));
  const [search, setSearch] = useState('');
  const categoryId = params.categoryId ? Number(params.categoryId) : undefined;
  const { data = [] } = useQuery(
    (db) => listTransactions(db, { month: search ? undefined : month, search: search || undefined, categoryId }),
    [month, search, categoryId],
  );
  const outflow = data.filter((t) => t.amount < 0 && t.category_kind !== 'transfer').reduce((s, t) => s - t.amount, 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 12, gap: 10, backgroundColor: c.card, borderBottomColor: c.border, borderBottomWidth: 1 }}>
        <TextInput
          placeholder="Search transactions"
          placeholderTextColor={c.muted}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
          style={{ backgroundColor: c.input, color: c.text, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.border }}
        />
        {!search && (
          <Row style={{ justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{formatMonth(month)}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>
                {data.length} transactions · ${outflow.toFixed(2)} out
              </Text>
            </View>
            <IconButton icon="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} />
          </Row>
        )}
      </View>
      <FlatList
        data={data}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90 }}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={<Empty icon="receipt" title="No transactions" message="Sync your accounts, import a CSV, or add one manually." />}
        renderItem={({ item: t }) => (
          <ListItem
            icon={(t.category_icon as IconName) ?? 'help-circle'}
            iconColor={t.category_color ?? c.muted}
            title={t.description}
            subtitle={`${formatDate(t.date)} · ${t.category_name ?? 'Uncategorized'}${t.pending ? ' · pending' : ''}`}
            right={<Money amount={t.amount} colored />}
            rightSub={t.account_name}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
          />
        )}
      />
      <View style={{ position: 'absolute', right: 20, bottom: 20, backgroundColor: c.primary, borderRadius: 28, padding: 14 }}>
        <IconButton icon="add" color={c.primaryText} onPress={() => router.push('/transaction/new')} />
      </View>
    </View>
  );
}
