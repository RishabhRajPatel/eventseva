import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
  const open = (b: Booking) => (tablet ? setSelectedId(b.id) : router.push(`/booking/${b.id}`));

  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID="bookings">
      <View style={styles.head}>
        <Txt variant="display" size="display" accessibilityRole="header">
          {t('requests.title')}
        </Txt>
        <Segmented options={options} value={segment} onChange={setSegment} />
      </View>
      <QueryView query={bookings}>
        {() => (
          <View style={styles.split}>
            <FlatList
              style={{ flex: 1 }}
              contentContainerStyle={styles.list}
              data={items}
              keyExtractor={(b) => b.id}
              refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => void bookings.refetch()} colors={[c.royal]} />}
              renderItem={({ item }) => <BookingCard booking={item} now={now} onOpen={() => open(item)} selected={tablet && item.id === selected?.id} />}
              ListEmptyComponent={<Empty icon="bookings" title={t(`requests.empty.${segment}.title`)} body={t(`requests.empty.${segment}.body`)} />}
            />
            {tablet ? (
              <ScrollView style={styles.detailPane} contentContainerStyle={styles.list}>
                {selected ? <BookingDetail booking={selected} now={now} /> : <Txt color={c.textMuted}>{t('requests.selectOne')}</Txt>}
              </ScrollView>
            ) : null}
          </View>
        )}
      </QueryView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream },
  head: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.lg, gap: space.lg },
  split: { flex: 1, flexDirection: 'row' },
  list: { paddingHorizontal: space.xl, paddingBottom: space.xxxl, gap: space.lg },
  detailPane: { flex: 1.2, borderLeftWidth: 1, borderLeftColor: c.lavender },
});
