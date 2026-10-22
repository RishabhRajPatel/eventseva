import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { rupees, type PartnerDashboard } from '@eventseva/app-shared';
import { useBookings, useDashboard, useNotifications, useVendor } from '../../lib/queries';
import { slotLabel, vendorStatus } from '../../lib/labels';
import { c, radius, space } from '../../lib/theme';
import { useIsTablet } from '../../hooks/useIsTablet';
import { useLang } from '../../hooks/useLang';
import { useNow } from '../../hooks/useNow';
import { BookingCard } from '../../components/BookingCard';
import { IconButton, LinkButton } from '../../components/Button';
import { Card, Row, Section } from '../../components/Card';
import { Pill } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** "Aaj" — today at a glance (VendorDash board). */
export default function Home() {
  const dashboard = useDashboard();
  const requests = useBookings('requested');
  const notifications = useNotifications();
  const vendor = useVendor();

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  const refresh = () => {
    void dashboard.refetch();
    void requests.refetch();
    void notifications.refetch();
  };

  return (
    <QueryView query={dashboard}>
      {(d) => (
        <ScrollView
          testID="home"
          style={{ backgroundColor: c.cream }}
          refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={refresh} colors={[c.royal]} />}
        >
          <HomeHeader d={d} name={vendor.data?.businessName ?? ''} unread={notifications.data?.unreadCount ?? 0} />
          <HomeBody d={d} />
        </ScrollView>
      )}
    </QueryView>
  );
}

function HomeHeader({ d, name, unread }: { d: PartnerDashboard; name: string; unread: number }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const status = d.status === 'approved' ? { label: t('home.verified'), tone: 'success' as const } : vendorStatus(t, d.status);
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xxl }]}>
      <View style={styles.headRow}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Pill label={status.label} tone={status.tone} />
          <Txt variant="display" size="xxl" color={c.white} numberOfLines={2} accessibilityRole="header">
            {name}
          </Txt>
        </View>
        <IconButton icon="bell" color={c.royal} label={t('notifications.title')} badge={unread} onPress={() => router.push('/notifications')} />
      </View>
      <View style={styles.tiles}>
        <Tile value={rupees(d.monthEarningsPaise)} label={t('home.thisMonth')} bg={c.white} valueColor={c.royal} onPress={() => router.push('/earnings')} />
        <Tile value={String(d.newRequests)} label={t('home.newRequests')} bg={c.peach} onPress={() => router.navigate('/bookings')} testID="tile-new" />
        <Tile value={String(d.monthBookings)} label={t('home.monthBookings')} bg={c.mint} onPress={() => router.navigate('/calendar')} />
      </View>
    </View>
  );
}

function Tile({ value, label, bg, valueColor = c.ink, onPress, testID }: { value: string; label: string; bg: string; valueColor?: string; onPress: () => void; testID?: string }) {
  return (
    <Card onPress={onPress} testID={testID} style={[styles.tile, { backgroundColor: bg }]} accessibilityLabel={`${label}: ${value}`}>
      <Txt variant="bold" size="xl" color={valueColor} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      <Txt size="xs">{label}</Txt>
    </Card>
  );
}

function HomeBody({ d }: { d: PartnerDashboard }) {
  const { t } = useTranslation();
  const lang = useLang();
  const now = useNow();
  const tablet = useIsTablet();
  const requests = useBookings('requested');
  const open = (requests.data ?? []).filter((b) => b.respondBy && new Date(b.respondBy).getTime() > now).slice(0, tablet ? 4 : 2);

  const stats: Array<{ icon: IconName; value: string; label: string; onPress: () => void }> = [
    { icon: 'clock', value: String(d.awaitingPayment), label: t('home.awaitingPayment'), onPress: () => router.navigate('/bookings') },
    { icon: 'rupee', value: rupees(d.pendingPayoutPaise), label: t('home.pendingPayout'), onPress: () => router.push('/earnings') },
    {
      icon: 'star',
      value: d.ratingCount ? `${d.ratingAvg.toFixed(1)} (${d.ratingCount})` : '—',
      label: t('home.rating'),
      onPress: () => router.push('/reviews'),
    },
    { icon: 'chat', value: String(d.unreadChats), label: t('home.unreadChats'), onPress: () => router.navigate('/chat') },
  ];

  return (
    <View style={styles.body}>
      <Section title={t('home.respond')} right={<LinkButton label={t('common.seeAll')} onPress={() => router.navigate('/bookings')} />}>
        {open.length ? (
          <View style={tablet ? styles.twoCol : { gap: space.md }}>
            {open.map((b) => (
              <View key={b.id} style={tablet ? styles.half : null}>
                <BookingCard booking={b} now={now} onOpen={() => router.push(`/booking/${b.id}`)} />
              </View>
            ))}
          </View>
        ) : (
          <Card testID="no-requests">
            <Txt size="md">{d.newRequests ? t('home.requestsWaiting', { n: d.newRequests }) : t('home.noRequests')}</Txt>
          </Card>
        )}
      </Section>

      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.label} style={tablet ? styles.quarter : styles.half}>
            <Card onPress={s.onPress} style={styles.stat} accessibilityLabel={`${s.label}: ${s.value}`}>
              <Icon name={s.icon} size={18} color={c.royal} />
              <Txt variant="bold" size="lg" numberOfLines={1}>
                {s.value}
              </Txt>
              <Txt size="xs">{s.label}</Txt>
            </Card>
          </View>
        ))}
      </View>

      <Section title={t('home.upcoming')}>
        <Card style={{ paddingVertical: space.xs }}>
          {d.upcoming.length ? (
            d.upcoming.map((u, i) => {
              const date = new Date(`${u.day}T00:00:00Z`);
              return (
                <Row key={u.id} first={i === 0} onPress={() => router.push(`/booking/${u.id}`)} testID={`upcoming-${u.id}`}>
                  <View style={styles.dateBlock}>
                    <Txt variant="bold" size="xl" color={c.royal}>
                      {date.getUTCDate()}
                    </Txt>
                    <Txt size="xs">{date.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short', timeZone: 'UTC' })}</Txt>
                  </View>
                  <View style={{ flex: 1, paddingVertical: space.sm }}>
                    <Txt variant="bold" size="md" numberOfLines={1}>
                      {u.eventTitle}
                    </Txt>
                    <Txt size="sm" numberOfLines={1}>
                      {u.itemTitle} · {slotLabel(t, u.slot)}
                    </Txt>
                  </View>
                  <Pill label={t('bookingStatus.confirmed')} tone="success" />
                </Row>
              );
            })
          ) : (
            <View style={{ paddingVertical: space.md }}>
              <Txt size="md">{t('home.noUpcoming')}</Txt>
            </View>
          )}
        </Card>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: c.indigo, paddingHorizontal: space.xl, paddingBottom: space.xxl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, gap: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  tiles: { flexDirection: 'row', gap: space.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  tile: { flex: 1, padding: space.md, gap: 2, borderRadius: radius.md },
  body: { padding: space.xl, gap: space.xl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  half: { width: '50%', padding: space.xs },
  quarter: { width: '25%', padding: space.xs },
  stat: { gap: 2, padding: space.md, minHeight: 88 },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  dateBlock: { width: 48, alignItems: 'center' },
});
