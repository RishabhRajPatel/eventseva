// Home (Home / HomeHindi / TabletHome boards).
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { CITY } from '../../lib/config';
import { keys } from '../../lib/queryClient';
import { useMe } from '../../lib/session';
import { c, radius, space } from '../../lib/theme';
import { useCategories, useNotificationsBadge, useOffers } from '../../hooks/useCatalog';
import { useLayout } from '../../hooks/useLayout';
import { AppText } from '../../components/AppText';
import { Card, Pill, SectionTitle } from '../../components/Bits';
import { Button, IconButton } from '../../components/Button';
import { CategoryTile, useCategoryLabel } from '../../components/CategoryTile';
import { OfferBanners } from '../../components/OfferBanners';
import { Icon } from '../../components/Icon';
import { CategoryGridSkeleton, VendorGridSkeleton, VendorRowsSkeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState, isOffline } from '../../components/States';
import { VendorCard, VendorRow } from '../../components/VendorCards';

const openSearch = (params: { category?: string; focus?: string } = {}) => router.navigate({ pathname: '/search', params });

export default function HomeScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const { isTablet, gridColumns, gutter, width, hasRail } = useLayout();
  const categories = useCategories();
  const top = useQuery({ queryKey: [...keys.vendors(), 'top'], queryFn: () => api.vendors({ limit: isTablet ? 8 : 5 }), staleTime: 5 * 60_000 });
  const unread = useNotificationsBadge();
  const offers = useOffers();
  const label = useCategoryLabel();
  const [showAll, setShowAll] = useState(false);

  const refresh = () => Promise.all([categories.refetch(), top.refetch(), offers.refetch()]);
  const cell = useMemo(() => ({ width: `${100 / (isTablet ? 8 : 4)}%` as const }), [isTablet]);
  const openCategory = useCallback((slug: string) => openSearch({ category: slug }), []);
  if (isOffline(categories.error) && isOffline(top.error)) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ErrorState error={categories.error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  const perRow = isTablet ? 8 : 4;
  const tileSize = isTablet ? 72 : 60;
  const cats = categories.data?.items ?? [];
  const visible = showAll || cats.length <= perRow ? cats : cats.slice(0, perRow - 1);
  const firstName = (me.name ?? '').split(' ')[0];
  const contentWidth = width - (hasRail ? 96 : 0) - gutter * 2;
  const cardWidth = Math.floor((contentWidth - 20 * (gridColumns - 1)) / gridColumns);

  const searchBox = (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={t('home.searchLabel')}
      onPress={() => openSearch({ focus: '1' })}
      style={[styles.search, isTablet && styles.searchTablet]}
    >
      <Icon name="search" size={18} color={c.textMuted} />
      <AppText size="md" color={c.textMuted} numberOfLines={1}>
        {t('home.searchPlaceholder')}
      </AppText>
    </Pressable>
  );

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={top.isRefetching} onRefresh={() => void refresh()} colors={[c.royal]} />}
      >
        {isTablet ? (
          <SafeAreaView edges={['top']} style={[styles.tabletHead, { paddingHorizontal: gutter }]}>
            <View style={styles.flex}>
              <AppText size="sm">{t('common.city')}</AppText>
              <AppText variant="display" size="display" accessibilityRole="header">
                {t('home.hello', { name: firstName })}
              </AppText>
            </View>
            {searchBox}
            <IconButton icon="bell" label={t('notifications.title')} onPress={() => router.push('/notifications')} tone="lavender" badge={unread} />
          </SafeAreaView>
        ) : (
          <SafeAreaView edges={['top']} style={[styles.header, { paddingHorizontal: gutter }]}>
            <View style={styles.headRow}>
              <View style={styles.flex}>
                <View style={styles.city}>
                  <Icon name="pin" size={14} color={c.white} />
                  <AppText size="sm" color={c.white}>
                    {t('common.city')}
                  </AppText>
                </View>
                <AppText variant="display" size="xxl" color={c.white} accessibilityRole="header" numberOfLines={1}>
                  {t('home.hello', { name: firstName })}
                </AppText>
              </View>
              <IconButton icon="bell" label={t('notifications.title')} onPress={() => router.push('/notifications')} iconColor={c.royal} badge={unread} />
            </View>
            {searchBox}
          </SafeAreaView>
        )}

        <View style={[styles.body, { paddingHorizontal: gutter }]}>
          <View style={styles.section}>
            <SectionTitle title={t('home.services')} />
            {categories.isPending ? (
              <CategoryGridSkeleton perRow={perRow} size={tileSize} />
            ) : (
              <View style={styles.grid}>
                {visible.map((cat) => (
                  <View key={cat.slug} style={cell}>
                    <CategoryTile icon={cat.icon} label={label(cat.slug, cat.name)} onPress={() => openCategory(cat.slug)} size={tileSize} />
                  </View>
                ))}
                {cats.length > perRow ? (
                  <View style={cell}>
                    <CategoryTile icon="more" more label={showAll ? t('home.less') : t('home.more')} onPress={() => setShowAll((s) => !s)} size={tileSize} />
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {offers.data && offers.data.items.length > 0 ? (
            <OfferBanners offers={offers.data.items} width={contentWidth} gutter={gutter} isTablet={isTablet} />
          ) : (
            <View style={[styles.banner, isTablet && styles.bannerTablet]}>
              <View style={[styles.bannerText, isTablet && styles.flex]}>
                <Pill label={t('home.bannerTag')} tone="peach" />
                <AppText variant="display" size="xl">
                  {t('home.bannerTitle')}
                </AppText>
              </View>
              <Button label={t('home.bannerAction')} variant="dark" size="md" onPress={() => router.push('/event/new')} style={styles.bannerButton} />
            </View>
          )}

          {/* EventSeva's own packages: several vendors booked in one go. */}
          <View style={styles.section}>
            <SectionTitle title={t('packages.homeEntry')} action={t('home.seeAll')} onAction={() => router.push('/packages')} />
            <Card style={styles.packageCard} onPress={() => router.push('/packages')} label={t('packages.homeEntry')}>
              <Icon name="star" size={20} color={c.royal} />
              <AppText size="sm" style={styles.flex}>
                {t('packages.homeEntrySub')}
              </AppText>
            </Card>
          </View>

          <View style={styles.section}>
            <SectionTitle title={t('home.topVendors')} action={t('home.seeAll')} onAction={() => openSearch()} />
            {top.isPending ? (
              isTablet ? (
                <VendorGridSkeleton columns={gridColumns} width={contentWidth} rows={1} />
              ) : (
                <VendorRowsSkeleton />
              )
            ) : top.error ? (
              <ErrorState error={top.error} onRetry={() => top.refetch()} />
            ) : top.data.items.length === 0 ? (
              <EmptyState
                compact
                icon="searchEmpty"
                title={t('home.noVendors')}
                actions={<Button label={t('home.bannerAction')} variant="outline" size="md" onPress={() => router.push('/event/new')} />}
              />
            ) : isTablet ? (
              <View style={styles.cardGrid}>
                {top.data.items.map((v) => (
                  <VendorCard key={v.id} vendor={v} width={cardWidth} />
                ))}
              </View>
            ) : (
              top.data.items.map((v) => <VendorRow key={v.id} vendor={v} city={CITY.name} />)
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  packageCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.xxxl },
  header: { backgroundColor: c.royal, paddingTop: space.xxl, paddingBottom: space.xxl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, gap: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  city: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tabletHead: { flexDirection: 'row', alignItems: 'center', gap: space.xxl, paddingTop: space.xxxl },
  search: { minHeight: 48, borderRadius: radius.md, backgroundColor: c.white, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchTablet: { flexBasis: 448, flexShrink: 1, minHeight: 52, borderWidth: 1.5, borderColor: c.lilac },
  body: { paddingTop: space.xl, gap: space.xl },
  section: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  banner: { borderRadius: 18, backgroundColor: c.lilac, padding: 18, gap: 10 },
  bannerTablet: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xxl },
  bannerText: { gap: 10 },
  bannerButton: { alignSelf: 'flex-start' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
});
