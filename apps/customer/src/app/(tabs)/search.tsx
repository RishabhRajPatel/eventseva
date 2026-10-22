// Search and category results (Search / Empty / TabletSearch boards).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees } from '@eventseva/app-shared';
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
import { MasonryGrid } from '../../components/MasonryGrid';
import { Sheet } from '../../components/Sheet';
import { EmptyState, ErrorState, Loading } from '../../components/States';
import { cardAspect, VendorCard } from '../../components/VendorCards';

const CARD_TEXT_HEIGHT = 92;

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

  // Opening a category from Home while this tab is already mounted.
  useEffect(() => {
    setCategory(params.category);
    if (params.category) setText('');
  }, [params.category]);

  const vendors = useInfiniteQuery({
    queryKey: [...keys.vendors(category), 'search'],
    queryFn: ({ pageParam }) => api.vendors({ category, page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const textCategory = matchCategory(text, cats);
  const all = useMemo(() => vendors.data?.pages.flatMap((p) => p.items) ?? [], [vendors.data]);
  const results = applyFilters(all, { text, minRating, maxPricePaise: maxPrice, sort }, textCategory != null && textCategory === category);
  const catName = cats.find((x) => x.slug === category)?.name;

  function onChangeText(v: string) {
    setText(v);
    const slug = matchCategory(v, cats);
    if (slug) setCategory(slug);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 600 && vendors.hasNextPage && !vendors.isFetchingNextPage) {
      void vendors.fetchNextPage();
    }
  }

  const clearAll = () => {
    setText('');
    setCategory(undefined);
    setMinRating(false);
    setMaxPrice(null);
    setSort('popular');
  };

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/'));
  const contentWidth = width - (hasRail ? 96 : 0) - gutter * 2;
  const countText = vendors.hasNextPage ? t('search.countMore', { count: results.length }) : t('search.count', { count: results.length });

  let body;
  if (vendors.isPending) body = <Loading />;
  else if (vendors.error && all.length === 0) body = <ErrorState error={vendors.error} onRetry={() => vendors.refetch()} />;
  else if (results.length === 0) {
    body = (
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
  } else {
    body = (
      <MasonryGrid
        items={results}
        columns={gridColumns}
        gap={isTablet ? 20 : 16}
        initialWidth={contentWidth}
        estimateHeight={(v, w) => w * cardAspect(v) + CARD_TEXT_HEIGHT}
        renderItem={(v, w) => <VendorCard vendor={v} width={w} />}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <SafeAreaView edges={['top']} style={[styles.top, { paddingHorizontal: gutter }]}>
        <View style={styles.searchRow}>
          <IconButton icon="back" label={t('common.back')} onPress={back} tone="lavender" />
          <View style={styles.inputBox}>
            <Icon name="search" size={18} />
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
            label={maxPrice != null ? t('search.budgetUpTo', { price: rupees(maxPrice) }) : t('search.budget')}
            selected={maxPrice != null}
            onPress={() => setSheet('budget')}
          />
          <Chip label={t('search.rating4')} selected={minRating} onPress={() => setMinRating((v) => !v)} />
          <Chip label={sort === 'popular' ? t('search.sort') : t(`search.sortBy.${sort}`)} selected={sort !== 'popular'} onPress={() => setSheet('sort')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('search.allServices')} tone="ink" selected={!category} onPress={() => setCategory(undefined)} />
          {cats.map((cat) => (
            <Chip key={cat.slug} label={cat.name} tone="ink" selected={category === cat.slug} onPress={() => setCategory(cat.slug)} />
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView contentContainerStyle={[styles.results, { paddingHorizontal: gutter }]} onScroll={onScroll} scrollEventThrottle={200} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <AppText variant="display" size={isTablet ? 28 : 'xl'} accessibilityRole="header" style={styles.flex}>
            {t('search.title', { what: catName ?? t('search.allServices') })}
          </AppText>
          {!vendors.isPending && results.length > 0 ? <AppText size="sm">{countText}</AppText> : null}
        </View>
        {body}
        {vendors.isFetchingNextPage ? <ActivityIndicator color={c.royal} style={styles.more} /> : null}
      </ScrollView>

      <Sheet visible={sheet === 'budget'} title={t('search.budgetTitle')} onClose={() => setSheet(null)}>
        <View style={styles.options}>
          <Chip label={t('search.anyBudget')} selected={maxPrice == null} onPress={() => (setMaxPrice(null), setSheet(null))} />
          {BUDGETS.map((b) => (
            <Chip key={b} label={t('search.budgetUpTo', { price: rupees(b) })} selected={maxPrice === b} onPress={() => (setMaxPrice(b), setSheet(null))} />
          ))}
        </View>
        <AppText size="sm">{t('search.budgetHint')}</AppText>
      </Sheet>
      <Sheet visible={sheet === 'sort'} title={t('search.sort')} onClose={() => setSheet(null)}>
        <View style={styles.options}>
          {(['popular', 'priceLow', 'rating'] as const).map((s) => (
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
  inputBox: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.lilac, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md },
  input: { flex: 1, minHeight: 48, fontSize: 16, color: c.text },
  chips: { gap: space.sm },
  results: { paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.md, flexGrow: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  more: { marginVertical: space.lg },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
