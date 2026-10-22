// Vendor page (Vendor board): photos, packages and services, free dates, reviews, chat and book.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addDays, formatDay, todayIst, type Media } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { errorText } from '../../../lib/errors';
import { keys } from '../../../lib/queryClient';
import { c, radius, space } from '../../../lib/theme';
import { itemKey, vendorItems } from '../../../lib/vendor';
import { useAvailability } from '../../../hooks/useAvailability';
import { useLayout } from '../../../hooks/useLayout';
import { useLanguage } from '../../../hooks/useLanguage';
import { useShortlist } from '../../../hooks/useShortlist';
import { AppText } from '../../../components/AppText';
import { Card, Notice, Pill, SectionTitle } from '../../../components/Bits';
import { Button, IconButton } from '../../../components/Button';
import { DateStrip } from '../../../components/DateStrip';
import { ItemOption } from '../../../components/ItemOption';
import { monthOf } from '../../../components/DatePicker';
import { ErrorState, Loading } from '../../../components/States';
import { VendorImage } from '../../../components/VendorImage';

export default function VendorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const insets = useSafeAreaInsets();
  const { width, isTablet, gutter } = useLayout();
  const vendor = useQuery({ queryKey: keys.vendor(id), queryFn: () => api.vendor(id) });
  const shortlist = useShortlist();
  const today = todayIst();
  const availability = useAvailability(id, [monthOf(today), monthOf(addDays(today, 31))]);
  const reviews = useInfiniteQuery({
    queryKey: keys.reviews(id),
    queryFn: ({ pageParam }) => api.reviews(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const chat = useMutation({
    mutationFn: () => api.startChat(id),
    onSuccess: ({ id: conversationId }) =>
      router.push({ pathname: '/chat/[id]', params: { id: conversationId, name: vendor.data?.businessName ?? '' } }),
  });

  const items = useMemo(() => (vendor.data ? vendorItems(vendor.data) : []), [vendor.data]);
  const photos = useMemo(() => (vendor.data?.media ?? []).filter((m: Media) => m.type === 'photo'), [vendor.data]);
  const selected = items.find((i) => itemKey(i) === selectedKey) ?? items[0];

  if (vendor.isPending) return <Loading />;
  if (vendor.error) {
    return (
      <SafeAreaView style={styles.flex}>
        <View style={{ paddingHorizontal: gutter, paddingTop: space.lg }}>
          <IconButton icon="back" label={t('common.back')} onPress={() => router.back()} />
        </View>
        <ErrorState error={vendor.error} onRetry={() => vendor.refetch()} />
      </SafeAreaView>
    );
  }

  const v = vendor.data;
  const heroHeight = isTablet ? 360 : 220;
  const saved = shortlist.isSaved(v.id);
  const packages = items.filter((i) => i.type === 'package');
  const services = items.filter((i) => i.type === 'service');
  const allReviews = reviews.data?.pages.flatMap((p) => p.items) ?? [];
  const place = [v.area, v.city.name].filter(Boolean).join(', ');
  const ratingText = v.rating.count > 0 ? ` · ★ ${v.rating.avg.toFixed(1)} (${t('vendor.reviewCount', { count: v.rating.count })})` : '';

  const book = () =>
    selected &&
    router.push({ pathname: '/vendor/[id]/book', params: { id: v.id, item: itemKey(selected), ...(day ? { day } : {}) } });

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={{ height: heroHeight }}>
          {photos.length ? (
            <FlatList
              data={photos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(m) => m.id}
              onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index }) => (
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('vendor.photoOf', { n: index + 1, total: photos.length })}
                  onPress={() => router.push({ pathname: '/vendor/[id]/photos', params: { id: v.id, index: String(index) } })}
                >
                  <VendorImage media={item} icon={v.category.icon} width={width} height={heroHeight} mode="wide" />
                </Pressable>
              )}
            />
          ) : (
            <VendorImage media={null} icon={v.category.icon} width={width} height={heroHeight} label={t('vendor.noPhotos')} />
          )}
          <View style={[styles.heroButtons, { top: insets.top + space.md, paddingHorizontal: gutter }]}>
            <IconButton icon="back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <IconButton icon="heart" label={saved ? t('vendor.unsave') : t('vendor.save')} onPress={() => shortlist.toggle(v.id)} iconColor={c.royal} filled={saved} />
          </View>
          {photos.length > 1 ? (
            <View style={styles.counter}>
              <AppText size="xs" color={c.white} variant="bold">
                {`${photoIndex + 1} / ${photos.length}`}
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={[styles.sheet, { paddingHorizontal: gutter }]}>
          <View style={[styles.inner, isTablet && styles.tablet]}>
            <View style={styles.gap6}>
              <View style={styles.pills}>
                <Pill label={t('vendor.verified')} tone="mint" />
                <Pill label={v.category.name} />
              </View>
              <AppText variant="display" size={26} accessibilityRole="header">
                {v.businessName}
              </AppText>
              <AppText size="sm">{place + ratingText}</AppText>
            </View>

            {v.about ? (
              <Pressable onPress={() => setAboutOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={t('vendor.about')}>
                <AppText size="md" numberOfLines={aboutOpen ? undefined : 4}>
                  {v.about}
                </AppText>
              </Pressable>
            ) : null}

            {items.length === 0 ? <Notice icon="alert">{t('vendor.noItems')}</Notice> : null}
            {packages.length ? (
              <View style={styles.section} accessibilityRole="radiogroup">
                <SectionTitle title={t('vendor.packages')} />
                {packages.map((i) => (
                  <ItemOption key={itemKey(i)} item={i} selected={selected === i} onPress={() => setSelectedKey(itemKey(i))} />
                ))}
              </View>
            ) : null}
            {services.length ? (
              <View style={styles.section} accessibilityRole="radiogroup">
                <SectionTitle title={t('vendor.services')} />
                {services.map((i) => (
                  <ItemOption key={itemKey(i)} item={i} selected={selected === i} onPress={() => setSelectedKey(itemKey(i))} />
                ))}
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionTitle title={t('vendor.pickDate')} />
              <DateStrip from={today} byDay={availability.byDay} value={day} onChange={(d) => setDay(d === day ? null : d)} />
            </View>

            <View style={styles.section}>
              <SectionTitle title={t('vendor.reviews')} />
              {allReviews.length === 0 && !reviews.isPending ? <AppText size="md">{t('vendor.noReviews')}</AppText> : null}
              {allReviews.map((r) => (
                <Card key={r.id} style={styles.review}>
                  <View style={styles.reviewHead}>
                    <AppText variant="bold" size="md" style={styles.flex}>
                      {r.customerName}
                    </AppText>
                    <AppText variant="bold" size="sm" color={c.royal}>{`★ ${r.rating}`}</AppText>
                  </View>
                  <AppText size="xs" color={c.textMuted}>
                    {formatDay(r.createdAt.slice(0, 10), lang)}
                  </AppText>
                  {r.comment ? <AppText size="md">{r.comment}</AppText> : null}
                  {r.vendorReply ? (
                    <View style={styles.reply}>
                      <AppText variant="bold" size="sm">
                        {t('vendor.reply')}
                      </AppText>
                      <AppText size="sm">{r.vendorReply}</AppText>
                    </View>
                  ) : null}
                </Card>
              ))}
              {reviews.hasNextPage ? (
                <Button label={t('vendor.moreReviews')} variant="outline" size="md" loading={reviews.isFetchingNextPage} onPress={() => reviews.fetchNextPage()} />
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={[styles.footer, { paddingHorizontal: gutter }]}>
        {chat.error ? (
          <AppText size="sm" color={c.danger}>
            {errorText(t, chat.error)}
          </AppText>
        ) : null}
        <View style={styles.footerRow}>
          <IconButton icon="chat" label={t('vendor.chat')} onPress={() => chat.mutate()} tone="outline" />
          <Button
            label={day ? t('vendor.bookOn', { date: formatDay(day, lang).replace(/ \d{4}$/, '') }) : t('vendor.book')}
            onPress={book}
            disabled={!selected}
            size="md"
            style={styles.flex}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: space.xxl, backgroundColor: c.white, flexGrow: 1 },
  heroButtons: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between' },
  counter: { position: 'absolute', bottom: space.xxl + space.sm, right: space.lg, backgroundColor: 'rgba(35,38,47,0.7)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  sheet: { marginTop: -space.xxl, backgroundColor: c.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.xl },
  inner: { gap: space.lg },
  tablet: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  gap6: { gap: 6 },
  pills: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  section: { gap: 10 },
  review: { gap: space.xs, borderWidth: 1, borderColor: c.lavender },
  reviewHead: { flexDirection: 'row', alignItems: 'center' },
  reply: { backgroundColor: c.cream, borderRadius: radius.sm, padding: space.sm, marginTop: space.xs },
  footer: { backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.lavender, paddingTop: space.md, paddingBottom: space.lg, gap: space.xs },
  footerRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
