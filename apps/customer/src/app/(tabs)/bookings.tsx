// My Events (Bookings board): event summary, progress, and its bookings with status.
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, todayIst, type Booking, type EventSummary } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { daysBetween, isConfirmed, isPending } from '../../lib/booking';
import { keys } from '../../lib/queryClient';
import { c, radius, space } from '../../lib/theme';
import { useLayout } from '../../hooks/useLayout';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { BookingRow } from '../../components/BookingRow';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Form';
import { BookingRowsSkeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';

const renderBooking = ({ item }: { item: Booking }) => <BookingRow booking={item} />;
const Separator = () => <View style={styles.separator} />;

type Filter = 'all' | 'confirmed' | 'pending';

/** The next upcoming event, or the latest past one. */
function defaultEvent(events: EventSummary[], today: string) {
  return events.find((e) => e.eventDate >= today) ?? events[events.length - 1];
}

export default function MyEventsScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { gutter, isTablet } = useLayout();
  const today = todayIst();
  const events = useQuery({ queryKey: keys.events, queryFn: api.events });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMemo(() => events.data?.items ?? [], [events.data]);
  const selected = list.find((e) => e.id === selectedId) ?? defaultEvent(list, today);
  const detail = useQuery({ queryKey: keys.event(selected?.id ?? ''), queryFn: () => api.event(selected!.id), enabled: !!selected });

  const refresh = () => Promise.all([events.refetch(), selected ? detail.refetch() : null]);
  const wrap = (body: ReactNode) => (
    <SafeAreaView edges={['top']} style={styles.flex}>
      {body}
    </SafeAreaView>
  );

  if (events.isPending) {
    return wrap(
      <View style={[styles.content, { paddingHorizontal: gutter }]}>
        <BookingRowsSkeleton count={4} />
      </View>,
    );
  }
  if (events.error) return wrap(<ErrorState error={events.error} onRetry={refresh} />);
  if (!selected) {
    return wrap(
      <EmptyState
        icon="calendar"
        title={t('events.emptyTitle')}
        body={t('events.emptyBody')}
        actions={
          <>
            <Button label={t('events.create')} onPress={() => router.push('/event/new')} />
            <Button label={t('events.findVendors')} variant="outline" onPress={() => router.navigate('/search')} />
          </>
        }
      />,
    );
  }

  const bookings = detail.data?.bookings ?? [];
  const shown = filter === 'all' ? bookings : bookings.filter((b) => (filter === 'confirmed' ? isConfirmed(b.status) : isPending(b.status)));
  const active = bookings.filter((b) => isConfirmed(b.status) || isPending(b.status));
  const confirmed = active.filter((b) => isConfirmed(b.status)).length;
  const percent = active.length ? Math.round((confirmed / active.length) * 100) : 0;
  const days = daysBetween(today, selected.eventDate);
  const daysLabel = days > 0 ? t('events.daysToGo', { count: days }) : days === 0 ? t('events.today') : t('events.over');
  const meta = [formatDay(selected.eventDate, lang), t('common.city'), selected.guestCount ? t('events.guests', { count: selected.guestCount }) : null]
    .filter(Boolean)
    .join(' · ');

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <AppText variant="display" size="display" accessibilityRole="header" style={styles.flex}>
          {t('events.title')}
        </AppText>
        <Button label={t('events.new')} icon="plus" size="md" variant="secondary" onPress={() => router.push('/event/new')} />
      </View>

      {list.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          {list.map((e) => (
            <Chip key={e.id} label={e.title} selected={e.id === selected.id} onPress={() => setSelectedId(e.id)} />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.flex}>
            <AppText variant="display" size="xl" color={c.white}>
              {selected.title}
            </AppText>
            <AppText size="sm" color={c.white}>
              {meta}
            </AppText>
          </View>
          <View style={styles.daysPill}>
            <AppText variant="bold" size="xs" color={c.warningText}>
              {daysLabel}
            </AppText>
          </View>
        </View>
        <View style={styles.progressText}>
          <AppText size="sm" color={c.white}>
            {t('events.progress', { done: confirmed, total: active.length })}
          </AppText>
          <AppText size="sm" color={c.white}>{`${percent}%`}</AppText>
        </View>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          accessibilityLabel={t('events.progress', { done: confirmed, total: active.length })}
        >
          <View style={[styles.bar, { width: `${percent}%` }]} />
        </View>
      </View>

      <View style={styles.chipsRow} accessibilityRole="radiogroup">
        {(['all', 'confirmed', 'pending'] as const).map((f) => (
          <Chip key={f} label={t(`events.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>
    </View>
  );

  const empty = detail.isPending ? (
    <BookingRowsSkeleton />
  ) : detail.error ? (
    <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
  ) : bookings.length ? (
    <EmptyState
      compact
      icon="calendar"
      title={t('events.noneInFilter')}
      actions={<Button label={t('events.showAll')} variant="outline" size="md" onPress={() => setFilter('all')} />}
    />
  ) : (
    <EmptyState
      compact
      icon="searchEmpty"
      title={t('events.noBookings')}
      actions={<Button label={t('events.findVendors')} size="md" onPress={() => router.navigate('/search')} />}
    />
  );

  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={[styles.flex, isTablet && styles.tablet]}>
        <FlashList
          data={detail.isPending || detail.error ? [] : shown}
          keyExtractor={(b) => b.id}
          renderItem={renderBooking}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xxl + space.xs, paddingBottom: space.xxxl }}
          refreshing={events.isRefetching || detail.isRefetching}
          onRefresh={() => void refresh()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: space.xxl + space.xs, paddingBottom: space.xxxl, gap: space.md },
  header: { gap: space.md, paddingBottom: space.md },
  separator: { height: space.md },
  tablet: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { gap: space.sm },
  chipsRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  hero: { backgroundColor: c.royal, borderRadius: 18, padding: 18, gap: space.md },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  daysPill: { backgroundColor: c.peach, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  progressText: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: c.white, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: c.mint },
});
