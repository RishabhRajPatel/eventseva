import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@eventseva/app-shared';
import { groupBookings, SEGMENTS, type Segment } from '../../lib/bookings';
import { useBookings } from '../../lib/queries';
import { c, space } from '../../lib/theme';
import { useIsTablet } from '../../hooks/useIsTablet';
import { useNow } from '../../hooks/useNow';
import { BookingCard } from '../../components/BookingCard';
import { BookingDetail } from '../../components/BookingDetail';
import { Segmented } from '../../components/Segmented';
import { Empty, QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Requests and bookings in four lists (VendorRequests board). Tablets show the detail alongside. */
export default function Bookings() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bookings = useBookings();
  const now = useNow();
  const tablet = useIsTablet();
  const [segment, setSegment] = useState<Segment>('new');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useMemo(() => groupBookings(bookings.data ?? [], now), [bookings.data, now]);

  const options = SEGMENTS.map((key) => ({ key, label: t(`requests.segments.${key}`), count: key === 'past' ? undefined : groups[key].length }));
  const items = groups[segment];
  const selected = tablet ? items.find((b) => b.id === selectedId) ?? items[0] : undefined;
  const open = useCallback((b: Booking) => (tablet ? setSelectedId(b.id) : router.push(`/booking/${b.id}`)), [tablet]);
  const empty = EMPTY_ACTION[segment];

  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID="bookings">
      <View style={styles.head}>
        <Txt variant="display" size="display" accessibilityRole="header">
          {t('requests.title')}
        </Txt>
        <Segmented options={options} value={segment} onChange={setSegment} />
      </View>
      <QueryView query={bookings} padded>
        {() => (
          <View style={styles.split}>
            <View style={{ flex: 1 }}>
              <FlashList
                contentContainerStyle={styles.list}
                data={items}
                keyExtractor={keyOf}
                extraData={selected?.id}
                ItemSeparatorComponent={Gap}
                refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => void bookings.refetch()} colors={[c.royal]} />}
                renderItem={({ item }) => <BookingCard booking={item} now={now} onOpen={open} selected={tablet && item.id === selected?.id} />}
                ListEmptyComponent={
                  <Empty
                    icon="bookings"
                    title={t(`requests.empty.${segment}.title`)}
                    body={t(`requests.empty.${segment}.body`)}
                    action={empty ? { label: t(empty.label), onPress: () => router.navigate(empty.href) } : undefined}
                  />
                }
              />
            </View>
            {tablet ? (
              <ScrollView style={styles.detailPane} contentContainerStyle={styles.pane}>
                {selected ? <BookingDetail booking={selected} now={now} /> : <Txt color={c.textMuted}>{t('requests.selectOne')}</Txt>}
              </ScrollView>
            ) : null}
          </View>
        )}
      </QueryView>
    </View>
  );
}

const keyOf = (b: Booking) => b.id;
const Gap = () => <View style={styles.gap} />;

/** One next step for each empty list (UX.md §5). */
const EMPTY_ACTION: Record<Segment, { label: string; href: '/calendar' | '/profile' } | null> = {
  new: { label: 'requests.empty.new.action', href: '/calendar' },
  awaitingPayment: null,
  upcoming: { label: 'requests.empty.upcoming.action', href: '/profile' },
  past: null,
};

const styles = StyleSheet.create({
  gap: { height: space.lg },
  page: { flex: 1, backgroundColor: c.cream },
  head: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.lg, gap: space.lg },
  split: { flex: 1, flexDirection: 'row' },
  list: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  pane: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  detailPane: { flex: 1.2, borderLeftWidth: 1, borderLeftColor: c.lavender },
});
