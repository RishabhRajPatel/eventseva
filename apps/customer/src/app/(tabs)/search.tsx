// Search and category results (Search / Empty / TabletSearch boards).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, todayIst, type VendorCard as Vendor } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { applyFilters, BUDGETS, matchCategory, type SortOrder } from '../../lib/search';
import { c, radius, space } from '../../lib/theme';
import { useCategories } from '../../hooks/useCatalog';
import { useLayout } from '../../hooks/useLayout';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { Button, IconButton } from '../../components/Button';
import { Chip } from '../../components/Form';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { VendorGridSkeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { VendorCard } from '../../components/VendorCards';

const SORTS = ['popular', 'priceLow', 'rating'] as const;

export default function SearchScreen() {
  const { t } = useTranslation();
  const { fonts } = useLanguage();
  const params = useLocalSearchParams<{ category?: string; focus?: string }>();
  const { gridColumns, gutter, width, hasRail, isTablet } = useLayout();
  const categories = useCategories();
  const cats = categories.data?.items ?? [];

  const [category, setCategory] = useState<string | undefined>(params.category);
  const [text, setText] = useState('');
  const [minRating, setMinRating] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [sort, setSort] = useState<SortOrder>('popular');
  const [sheet, setSheet] = useState<'budget' | 'sort' | null>(null);
  // "Near my venue": the next event with a pinned venue sorts vendors by distance from it.
  const events = useQuery({ queryKey: keys.events, queryFn: api.events, staleTime: 60_000 });
  const venueEvent = useMemo(
    () => (events.data?.items ?? []).filter((e) => e.venueLocation && e.eventDate >= todayIst()).sort((a, b) => a.eventDate.localeCompare(b.eventDate))[0] ?? null,
    [events.data],
  );
  const [nearby, setNearby] = useState(false);
  const near = nearby && venueEvent?.venueLocation ? venueEvent.venueLocation : null;

  // Opening a category from Home while this tab is already mounted.
  useEffect(() => {
    setCategory(params.category);
    if (params.category) setText('');
  }, [params.category]);

  const vendors = useInfiniteQuery({
    queryKey: [...keys.vendors(category), 'search', near?.lat ?? null, near?.lng ?? null],
    queryFn: ({ pageParam }) =>
      api.vendors({ category, page: pageParam, limit: 20, ...(near ? { lat: near.lat, lng: near.lng, sort: 'nearest' as const } : {}) }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    staleTime: 5 * 60_000,
  });

  const textCategory = matchCategory(text, cats);
  const all = useMemo(() => vendors.data?.pages.flatMap((p) => p.items) ?? [], [vendors.data]);
  const results = useMemo(
    () => applyFilters(all, { text, minRating, maxPricePaise: maxPrice, sort }, textCategory != null && textCategory === category),
    [all, text, minRating, maxPrice, sort, textCategory, category],
  );
  const catName = cats.find((x) => x.slug === category)?.name;

  function onChangeText(v: string) {
    setText(v);
    const slug = matchCategory(v, cats);
    if (slug) setCategory(slug);
  }

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = vendors;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const clearAll = () => {
    setText('');
    setCategory(undefined);
    setMinRating(false);
    setMaxPrice(null);
    setSort('popular');
  };

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/'));
  const contentWidth = width - (hasRail ? 96 : 0) - gutter * 2;
  const gap = isTablet ? 20 : 16;
  // Masonry columns: each cell is (width + gap) / columns wide and pads itself by half a gap.
  const cardWidth = Math.floor((contentWidth + gap) / gridColumns - gap);
  const cellStyle = useMemo(() => ({ paddingHorizontal: gap / 2, paddingBottom: gap }), [gap]);
  const renderItem = useCallback(
    ({ item }: { item: Vendor }) => (
      <View style={cellStyle}>
        <VendorCard vendor={item} width={cardWidth} />
      </View>
    ),
    [cellStyle, cardWidth],
  );
  const countText = vendors.hasNextPage ? t('search.countMore', { count: results.length }) : t('search.count', { count: results.length });

  const title = (
    <View style={[styles.titleRow, { paddingHorizontal: gap / 2 }]}>
      <AppText variant="display" size={isTablet ? 'display' : 'xl'} accessibilityRole="header" style={styles.flex}>
        {t('search.title', { what: catName ?? t('search.allServices') })}
      </AppText>
      {!vendors.isPending && results.length > 0 ? <AppText size="sm">{countText}</AppText> : null}
    </View>
  );
  const empty = (
    <EmptyState
      title={t('search.emptyTitle')}
      body={maxPrice != null ? t('search.emptyBudget', { price: rupees(maxPrice) }) : t('search.emptyBody')}
      actions={
        <>
          {maxPrice != null ? <Button label={t('search.removeBudget')} onPress={() => setMaxPrice(null)} /> : null}
          <Button label={t('search.clearFilters')} variant={maxPrice != null ? 'outline' : 'primary'} onPress={clearAll} />
        </>
      }
    />
  );

  let body;
  if (vendors.isPending) {
    body = (
      <View style={[styles.results, { paddingHorizontal: gutter }]}>
        <VendorGridSkeleton columns={gridColumns} width={contentWidth} rows={3} />
      </View>
    );
  } else if (vendors.error && all.length === 0) {
    body = <ErrorState error={vendors.error} onRetry={() => vendors.refetch()} />;
  } else {
    body = (
      <FlashList
        key={gridColumns}
        data={results}
        masonry
        numColumns={gridColumns}
        keyExtractor={(v) => v.id}
        renderItem={renderItem}
        ListHeaderComponent={title}
        ListEmptyComponent={empty}
        ListFooterComponent={isFetchingNextPage ? <VendorGridSkeleton columns={gridColumns} width={contentWidth} rows={1} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: gutter - gap / 2, paddingTop: space.lg, paddingBottom: space.xxxl }}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <SafeAreaView edges={['top']} style={[styles.top, { paddingHorizontal: gutter }]}>
        <View style={styles.searchRow}>
          <IconButton icon="back" label={t('common.back')} onPress={back} tone="lavender" />
          <View style={styles.inputBox}>
            <Icon name="search" size={18} color={c.textMuted} />
            <TextInput
              value={text}
              onChangeText={onChangeText}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={c.textMuted}
              accessibilityLabel={t('search.label')}
              autoFocus={params.focus === '1'}
              returnKeyType="search"
              style={[styles.input, { fontFamily: fonts.body }]}
            />
            {text ? <IconButton icon="close" label={t('search.clearText')} onPress={() => setText('')} /> : null}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            role="button"
            label={maxPrice != null ? t('search.budgetUpTo', { price: rupees(maxPrice) }) : t('search.budget')}
            selected={maxPrice != null}
            onPress={() => setSheet('budget')}
          />
          {venueEvent ? (
            <Chip role="checkbox" label={t('nearby.chip', { event: venueEvent.title })} selected={nearby} onPress={() => setNearby((v) => !v)} />
          ) : null}
          <Chip role="checkbox" label={t('search.rating4')} selected={minRating} onPress={() => setMinRating((v) => !v)} />
          <Chip role="button" label={sort === 'popular' ? t('search.sort') : t(`search.sortBy.${sort}`)} selected={sort !== 'popular'} onPress={() => setSheet('sort')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          <Chip label={t('search.allServices')} selected={!category} onPress={() => setCategory(undefined)} />
          {cats.map((cat) => (
            <Chip key={cat.slug} label={cat.name} selected={category === cat.slug} onPress={() => setCategory(cat.slug)} />
          ))}
        </ScrollView>
      </SafeAreaView>

      {body}

      <Sheet visible={sheet === 'budget'} title={t('search.budgetTitle')} onClose={() => setSheet(null)}>
        <View style={styles.options} accessibilityRole="radiogroup">
          <Chip label={t('search.anyBudget')} selected={maxPrice == null} onPress={() => (setMaxPrice(null), setSheet(null))} />
          {BUDGETS.map((b) => (
            <Chip key={b} label={t('search.budgetUpTo', { price: rupees(b) })} selected={maxPrice === b} onPress={() => (setMaxPrice(b), setSheet(null))} />
          ))}
        </View>
        <AppText size="sm">{t('search.budgetHint')}</AppText>
      </Sheet>
      <Sheet visible={sheet === 'sort'} title={t('search.sort')} onClose={() => setSheet(null)}>
        <View style={styles.options} accessibilityRole="radiogroup">
          {SORTS.map((s) => (
            <Chip key={s} label={t(`search.sortBy.${s}`)} selected={sort === s} onPress={() => (setSort(s), setSheet(null))} />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.lavender, paddingTop: space.xxl, paddingBottom: space.md, gap: space.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  inputBox: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.outline, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md },
  input: { flex: 1, minHeight: 48, fontSize: 16, color: c.text },
  chips: { gap: space.sm },
  results: { paddingTop: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, paddingBottom: space.md },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
