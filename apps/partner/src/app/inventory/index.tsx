import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { rupees, type InventoryItem } from '@eventseva/app-shared';
import { categoryName, itemUnit, priceLabel, qualityLabel, useInventory, useItemCategories } from '../../lib/inventory';
import { thumbUrl } from '../../lib/media';
import { c, radius, space } from '../../lib/theme';
import { useLang } from '../../hooks/useLang';
import { Button, LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceChip, Pill } from '../../components/Chip';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Empty, QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Rental items (tent, furniture, utensils …): search, filter by category, stock free right now. */
export default function Inventory() {
  const { t } = useTranslation();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const items = useInventory(q, categoryId);
  const categories = useItemCategories();

  return (
    <Screen
      back
      title={t('inventory.title')}
      refreshing={items.isRefetching}
      onRefresh={() => void items.refetch()}
      right={<LinkButton testID="rental-settings" label={t('inventory.settings')} onPress={() => router.push('/rental-settings')} />}
      footer={<Button testID="add-item" size="lg" icon="plus" label={t('inventory.add')} onPress={() => router.push('/inventory/new')} />}
      testID="inventory"
    >
      <Field
        testID="inventory-search"
        label={t('inventory.search')}
        value={q}
        onChangeText={setQ}
        placeholder={t('inventory.searchPlaceholder')}
        returnKeyType="search"
        maxLength={60}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('inventory.category')}>
        <ChoiceChip testID="cat-all" label={t('inventory.all')} selected={!categoryId} onPress={() => setCategoryId(null)} />
        {(categories.data ?? []).map((cat) => (
          <ChoiceChip
            key={cat.id}
            testID={`cat-${cat.key ?? cat.id}`}
            label={cat.itemCount ? `${categoryName(cat, lang)} · ${cat.itemCount}` : categoryName(cat, lang)}
            selected={categoryId === cat.id}
            onPress={() => setCategoryId(cat.id)}
          />
        ))}
      </ScrollView>
      <QueryView query={items}>
        {(list) =>
          list.length ? (
            <View style={{ gap: space.md }}>
              {list.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </View>
          ) : (
            <Empty
              icon="tent"
              title={t(q || categoryId ? 'inventory.emptySearch' : 'inventory.emptyTitle')}
              body={q || categoryId ? undefined : t('inventory.emptyBody')}
              action={q || categoryId ? undefined : { label: t('inventory.add'), onPress: () => router.push('/inventory/new') }}
            />
          )
        }
      </QueryView>
    </Screen>
  );
}

function ItemCard({ item }: { item: InventoryItem }) {
  const { t } = useTranslation();
  const photo = item.photos.find((p) => p.status !== 'rejected');
  const url = photo ? thumbUrl(photo, 64, 64) : null;
  const usable = item.totalQty - item.repairQty;
  const low = item.availableNow !== undefined && item.availableNow < item.minQty;
  return (
    <Card onPress={() => router.push(`/inventory/${item.id}`)} testID={`item-${item.id}`} accessibilityLabel={item.name}>
      <View style={styles.row}>
        <View style={styles.thumb}>
          {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" placeholder={photo?.blurhash ? { blurhash: photo.blurhash } : undefined} /> : <Icon name="image" size={22} color={c.textMuted} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bold" size="md" numberOfLines={2}>
            {item.name}
          </Txt>
          <Txt size="sm" color={c.textMuted}>
            {priceLabel(t, rupees(item.rentPaise), item)} · {qualityLabel(t, item)}
          </Txt>
          <Txt size="sm" color={low ? c.danger : c.text} testID={`stock-${item.id}`}>
            {t('inventory.stockLine', { free: item.availableNow ?? usable, total: item.totalQty, unit: itemUnit(t, item.unit) })}
            {item.repairQty ? ` · ${t('inventory.inRepair', { n: item.repairQty })}` : ''}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: space.xs }}>
          {!item.isActive ? <Pill label={t('inventory.hidden')} tone="neutral" /> : null}
          {item.condition === 'needs_repair' ? <Pill label={t('inventory.condition.needs_repair')} tone="warning" /> : null}
          {item.openBookings ? <Pill label={t('inventory.openBookings', { count: item.openBookings })} tone="info" /> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: space.sm, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: c.lilac, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
