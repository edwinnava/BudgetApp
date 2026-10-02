import { View } from 'react-native';
import { useQuery } from '../db/hooks';
import { listAccounts, listCategories, Category, Account } from '../db/repo';
import { ListItem, PickerModal, IconName } from './ui';

export function CategoryPicker({
  visible, onClose, onPick, allowNone,
}: { visible: boolean; onClose: () => void; onPick: (c: Category | null) => void; allowNone?: boolean }) {
  const { data = [] } = useQuery(listCategories);
  const items: (Category | null)[] = allowNone ? [null, ...data] : data;
  return (
    <PickerModal
      visible={visible}
      onClose={onClose}
      title="Category"
      items={items}
      keyOf={(c) => String(c?.id ?? 'none')}
      onPick={onPick}
      render={(c) =>
        c ? (
          <ListItem icon={c.icon as IconName} iconColor={c.color} title={c.name} subtitle={c.kind !== 'expense' ? `${c.kind} (not counted as spending)` : undefined} />
        ) : (
          <ListItem icon="help-circle" title="Uncategorized" />
        )
      }
    />
  );
}

export function AccountPicker({
  visible, onClose, onPick, filter,
}: { visible: boolean; onClose: () => void; onPick: (a: Account) => void; filter?: (a: Account) => boolean }) {
  const { data = [] } = useQuery((db) => listAccounts(db, false));
  const items = filter ? data.filter(filter) : data;
  return (
    <PickerModal
      visible={visible}
      onClose={onClose}
      title="Account"
      items={items}
      keyOf={(a) => a.id}
      onPick={onPick}
      render={(a) => (
        <View>
          <ListItem icon={a.type === 'credit' ? 'card' : 'wallet'} title={a.name} subtitle={[a.institution, a.type].filter(Boolean).join(' · ')} />
        </View>
      )}
    />
  );
}
