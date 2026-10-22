// Saved (shortlisted) vendors.
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { space } from '../lib/theme';
import { useLayout } from '../hooks/useLayout';
import { useShortlist } from '../hooks/useShortlist';
import { Button } from '../components/Button';
import { MasonryGrid } from '../components/MasonryGrid';
import { Screen, ScreenHeader } from '../components/Screen';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { cardAspect, VendorCard } from '../components/VendorCards';

export default function SavedScreen() {
  const { t } = useTranslation();
  const { gridColumns, gutter, width } = useLayout();
  const { query } = useShortlist();
  // Stand-in rows added while saving have no name yet.
  const items = (query.data?.items ?? []).filter((v) => v.businessName);

  let body;
  if (query.isPending) body = <Loading />;
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
      <ScrollView contentContainerStyle={styles.list}>
        <MasonryGrid
          items={items}
          columns={gridColumns}
          initialWidth={Math.min(width, 760) - gutter * 2}
          estimateHeight={(v, w) => w * cardAspect(v) + 80}
          renderItem={(v, w) => <VendorCard vendor={v} width={w} />}
        />
      </ScrollView>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('saved.title')} />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { paddingBottom: space.xxxl } });
