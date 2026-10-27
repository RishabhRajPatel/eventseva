import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDay, type Booking } from '@eventseva/app-shared';
import { remaining } from '../lib/bookings';
import { bookingStatus, slotLabel, timeLeftLabel } from '../lib/labels';
import { c, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Card } from './Card';
import { Pill } from './Chip';
import { MoneyBreakdown } from './MoneyBreakdown';
import { RequestActions } from './RequestActions';
import { Txt } from './Txt';

/** The countdown for requests (to respondBy) and unpaid bookings (to payBy), else the status. */
export function BookingBadge({ booking, now }: { booking: Booking; now: number }) {
  const { t } = useTranslation();
  const deadline = booking.status === 'requested' ? booking.respondBy : booking.status === 'accepted' ? booking.payBy : null;
  if (deadline) {
    const left = remaining(deadline, now);
    if (!left) return <Pill testID="badge" label={t('time.timeOver')} tone="neutral" />;
    return <Pill testID="badge" label={timeLeftLabel(t, left)} tone={left.urgent ? 'danger' : 'warning'} />;
  }
  const s = bookingStatus(t, booking.status);
  return <Pill testID="badge" label={s.label} tone={s.tone} />;
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Txt size="xs" color={c.textMuted}>
        {label}
      </Txt>
      <Txt variant="bold" size="sm">
        {value}
      </Txt>
    </View>
  );
}

/** One request or booking in a list. Memoised: pass a stable `onOpen`. */
export const BookingCard = memo(function BookingCard({ booking, now, onOpen, selected }: { booking: Booking; now: number; onOpen: (b: Booking) => void; selected?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const isRequest = booking.status === 'requested' && !!remaining(booking.respondBy, now);
  return (
    <Card testID={`booking-${booking.id}`} onPress={() => onOpen(booking)} style={[styles.card, selected ? styles.selected : null]} accessibilityLabel={booking.event.title}>
      <View style={styles.head}>
        <Txt variant="bold" size="lg" style={{ flex: 1 }} numberOfLines={2}>
          {booking.event.title}
        </Txt>
        <BookingBadge booking={booking} now={now} />
      </View>
      <View style={styles.grid}>
        <Detail label={t('booking.date')} value={`${formatDay(booking.day, lang)} · ${slotLabel(t, booking.slot)}`} />
        <Detail label={t('booking.item')} value={booking.quantity > 1 ? `${booking.item.title} × ${booking.quantity}` : booking.item.title} />
        {booking.customer?.name ? <Detail label={t('booking.customer')} value={booking.customer.name} /> : null}
        <Detail label={t('booking.event')} value={t(`eventType.${booking.event.eventType}`)} />
      </View>
      {booking.note ? (
        <View style={styles.note}>
          <Txt size="sm">“{booking.note}”</Txt>
        </View>
      ) : null}
      {booking.status !== 'rejected' && booking.status !== 'expired' ? <MoneyBreakdown booking={booking} /> : null}
      {isRequest ? <RequestActions bookingId={booking.id} /> : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm },
  detail: { width: '50%', paddingRight: space.sm },
  note: { backgroundColor: c.cream, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: space.md },
  card: { gap: space.md },
  selected: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
});
