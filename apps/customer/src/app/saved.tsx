// Saved (shortlisted) vendors.
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import type { SavedVendor } from '../lib/api';
import { space } from '../lib/theme';
import { useLayout } from '../hooks/useLayout';
import { useShortlist } from '../hooks/useShortlist';
import { Button } from '../components/Button';
import { Screen, ScreenHeader } from '../components/Screen';
import { VendorGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { VendorCard } from '../components/VendorCards';

const GAP = 16;

export default function SavedScreen() {
  const { t } = useTranslation();
  const { gridColumns, gutter, width } = useLayout();
  const { query } = useShortlist();
  // Stand-in rows added while saving have no name yet.
  const items = useMemo(() => (query.data?.items ?? []).filter((v) => v.businessName), [query.data]);
  const contentWidth = Math.min(width, 760) - gutter * 2;
  const cardWidth = Math.floor((contentWidth + GAP) / gridColumns - GAP);
  const renderItem = useCallback(
    ({ item }: { item: SavedVendor }) => (
      <View style={styles.cell}>
        <VendorCard vendor={item} width={cardWidth} />
      </View>
    ),
    [cardWidth],
  );

  let body;
  if (query.isPending) body = <VendorGridSkeleton columns={gridColumns} width={contentWidth} />;
  else if (query.error) body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0) {
    body = (
      <EmptyState
        icon="heart"
        title={t('saved.emptyTitle')}
        body={t('saved.emptyBody')}
        actions={<Button label={t('events.findVendors')} onPress={() => router.navigate('/search')} />}
      />
    );
  } else {
    body = (
      <FlashList
        key={gridColumns}
        data={items}
        masonry
        numColumns={gridColumns}
        keyExtractor={(v) => v.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('saved.title')} />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: -GAP / 2, paddingBottom: space.xxxl },
  cell: { paddingHorizontal: GAP / 2, paddingBottom: GAP },
});
