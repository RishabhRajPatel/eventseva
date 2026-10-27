// One booking, with what the customer can do in each status (docs/API.md status table).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addDays, formatDateTime, formatDay, formatPhone, rupees, timeLeft, todayIst, type Booking } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { canCancel, isConfirmed, isPending } from '../../lib/booking';
import { errorText } from '../../lib/errors';
import { keys } from '../../lib/queryClient';
import { c, radius, space } from '../../lib/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { useNow } from '../../hooks/useNow';
import { AppText } from '../../components/AppText';
import { Card, Divider, MoneyRow, Notice, StatusPill } from '../../components/Bits';
import { CancelDialog, ReviewSheet } from '../../components/BookingSheets';
import { Button } from '../../components/Button';
import { CouponBox, CouponMoneyRows, minus } from '../../components/Coupons';
import { Icon, type IconName } from '../../components/Icon';
import { Screen, ScreenHeader } from '../../components/Screen';
import { ProgressBanner, TripCard } from '../../components/TripCard';
import { CardsSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/States';
import { openLink } from '../../lib/links';
import { RentalSection } from '../../components/RentalSection';

export default function BookingScreen() {
  const { id, sent } = useLocalSearchParams<{ id: string; sent?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  // On the event day the vendor's "on the way" / "reached" should show up quickly.
  const booking = useQuery({
    queryKey: keys.booking(id),
    queryFn: () => api.booking(id),
    refetchInterval: (q) => (q.state.data?.status === 'confirmed' && q.state.data.day <= addDays(todayIst(), 1) ? 20_000 : 60_000),
  });
  const [sheet, setSheet] = useState<'cancel' | 'review' | null>(null);
  const [reviewed, setReviewed] = useState(false);
  // Reuse the existing conversation when the booking has one; otherwise start (get-or-create) it.
  const chat = useMutation({
    mutationFn: async (b: Booking) => (b.conversationId ? { id: b.conversationId } : api.startChat(b.vendor.id)),
    onSuccess: ({ id: conversationId }) =>
      router.push({ pathname: '/chat/[id]', params: { id: conversationId, name: booking.data?.vendor.businessName ?? '' } }),
  });

  if (booking.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('booking.title')} />
        <CardsSkeleton count={3} height={130} />
      </Screen>
    );
  }
  if (booking.error) {
    return (
      <Screen>
        <ScreenHeader title={t('booking.title')} />
        <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
      </Screen>
    );
  }
  const b = booking.data;
  const qtyText = b.quantity > 1 ? ` × ${b.quantity}` : '';

  return (
    <Screen scroll keyboard>
      <ScreenHeader title={b.vendor.businessName} subtitle={b.event.title} right={<StatusPill status={b.status} />} />
      {sent === '1' && b.status === 'requested' ? (
        <Notice icon="checkCircle" tone="mint">
          {t('booking.sent')}
        </Notice>
      ) : null}

      <ProgressBanner booking={b} />

      <StatusCard booking={b} onPay={() => router.push({ pathname: '/pay/[id]', params: { id: b.id } })} onReview={() => setSheet('review')} reviewed={reviewed || b.reviewed} />

      <Card style={styles.card}>
        <Row
          icon="calendar"
          text={b.startsAt && b.endsAt ? t('rent.window', { from: formatDateTime(b.startsAt, lang), until: formatDateTime(b.endsAt, lang) }) : `${formatDay(b.day, lang, true)} · ${t(`slots.${b.slot}.label`)} (${t(`slots.${b.slot}.hours`)})`}
        />
        <Row icon="star" text={b.bookingType === 'slot' ? `${b.item.title}${qtyText}` : b.item.title} />
        <Row icon="home" text={`${b.event.title} · ${t(`eventTypes.${b.event.eventType}`)}`} />
        {b.event.guestCount ? <Row icon="user" text={t('events.guests', { count: b.event.guestCount })} /> : null}
        {b.event.venueAddress ? <Row icon="pin" text={b.event.venueLandmark ? `${b.event.venueAddress} (${b.event.venueLandmark})` : b.event.venueAddress} /> : null}
        {b.note ? <Row icon="chat" text={b.note} /> : null}
      </Card>

      <TripCard booking={b} />

      {b.bookingType === 'rental' ? <RentalSection booking={b} /> : null}

      <Card style={styles.card}>
        <MoneyRow label={t('booking.total')} value={rupees(b.amountPaise)} />
        {b.discountPaise > 0 && (isPending(b.status) || isConfirmed(b.status)) ? (
          <CouponMoneyRows booking={b} paid={isConfirmed(b.status)} />
        ) : (
          <>
            <MoneyRow label={isConfirmed(b.status) ? t('booking.advancePaid') : t('booking.advance')} value={rupees(b.advancePaise)} accent />
            {b.discountPaise > 0 ? <MoneyRow label={t('coupon.line', { code: b.couponCode ?? '' })} value={minus(b.discountPaise)} /> : null}
          </>
        )}
        <MoneyRow label={t('booking.balance')} value={rupees(b.balancePaise)} />
        {b.refundPaise > 0 ? (
          <>
            <Divider />
            <MoneyRow label={t('booking.refund')} value={rupees(b.refundPaise)} strong />
          </>
        ) : null}
      </Card>

      {isPending(b.status) ? <CouponBox booking={b} /> : null}

      <View style={styles.actions}>
        {b.status !== 'expired' ? (
          <Button label={t('booking.chat')} icon="chat" variant="outline" onPress={() => chat.mutateAsync(b)} />
        ) : null}
        {chat.error ? (
          <AppText size="sm" color={c.danger}>
            {errorText(t, chat.error)}
          </AppText>
        ) : null}
        {canCancel(b) ? <Button label={t('booking.cancel')} variant="dangerOutline" onPress={() => setSheet('cancel')} /> : null}
        <Button
          label={t('booking.help')}
          variant="secondary"
          size="md"
          onPress={() => router.push({ pathname: '/help', params: { bookingId: b.id } })}
        />
      </View>

      <CancelDialog booking={b} visible={sheet === 'cancel'} onClose={() => setSheet(null)} />
      <ReviewSheet booking={b} visible={sheet === 'review'} onClose={() => setSheet(null)} onDone={() => setReviewed(true)} />
    </Screen>
  );
}

function Row({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={18} color={c.royal} />
      <AppText size="md" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

/** The status box: what is happening, any deadline, and the main action. */
function StatusCard({ booking: b, onPay, onReview, reviewed }: { booking: Booking; onPay: () => void; onReview: () => void; reviewed: boolean }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const now = useNow();
  const left = (iso: string | null) => (iso ? timeLeft(iso, now) : null);
  const bookAnother = <Button label={t('booking.bookAnother')} onPress={() => router.navigate('/search')} />;

  switch (b.status) {
    case 'requested': {
      const time = left(b.respondBy);
      return (
        <View style={[styles.status, styles.lavender]}>
          <AppText variant="bold" size="lg">{t('status.requested.title')}</AppText>
          <AppText size="md" accessibilityLiveRegion="polite">
            {time ? t('booking.replyWithin', { time }) : t('booking.replyLate')}
          </AppText>
        </View>
      );
    }
    case 'accepted': {
      const time = left(b.payBy);
      return (
        <View style={[styles.status, styles.peach]}>
          <AppText variant="bold" size="lg" color={c.warningText}>
            {t('status.accepted.title', { amount: rupees(b.payNowPaise) })}
          </AppText>
          <AppText size="md" accessibilityLiveRegion="polite">
            {time ? t('booking.payWithin', { time }) : t('booking.payLate')}
          </AppText>
          {b.payBy ? <AppText size="sm">{t('booking.payBy', { when: formatDateTime(b.payBy, lang) })}</AppText> : null}
          {time ? <Button label={t('booking.pay', { amount: rupees(b.payNowPaise) })} onPress={onPay} /> : null}
        </View>
      );
    }
    case 'confirmed':
      return (
        <View style={[styles.status, styles.mint]}>
          <AppText variant="bold" size="lg" color={c.successText}>
            {t('status.confirmed.title')}
          </AppText>
          {b.vendor.phone ? (
            <>
              <AppText size="md">{t('booking.vendorPhone', { phone: formatPhone(b.vendor.phone) })}</AppText>
              <Button label={t('booking.call')} icon="phone" variant="dark" onPress={() => openLink(`tel:${b.vendor.phone}`)} />
            </>
          ) : null}
          <AppText size="sm">{t('booking.balanceAtEvent', { amount: rupees(b.balancePaise) })}</AppText>
        </View>
      );
    case 'completed':
      return (
        <View style={[styles.status, styles.mintLight]}>
          <AppText variant="bold" size="lg" color={c.successText}>
            {t('status.completed.title')}
          </AppText>
          {reviewed ? (
            <AppText size="md">{t('review.thanks')}</AppText>
          ) : (
            <>
              <AppText size="md">{t('booking.reviewAsk')}</AppText>
              <Button label={t('booking.review')} icon="star" onPress={onReview} />
            </>
          )}
        </View>
      );
    case 'rejected':
      return (
        <View style={[styles.status, styles.white]}>
          <AppText variant="bold" size="lg">{t('status.rejected.title')}</AppText>
          {b.cancelReason ? <AppText size="md">{t('booking.reason', { reason: b.cancelReason })}</AppText> : null}
          {bookAnother}
        </View>
      );
    case 'expired':
      return (
        <View style={[styles.status, styles.white]}>
          <AppText variant="bold" size="lg">{t('status.expired.title')}</AppText>
          <AppText size="md">{t('booking.expiredBody')}</AppText>
          {bookAnother}
        </View>
      );
    case 'cancelled_by_customer':
    case 'cancelled_by_vendor':
      return (
        <View style={[styles.status, styles.white]}>
          <AppText variant="bold" size="lg">{t(`status.${b.status}.title`)}</AppText>
          {b.cancelReason ? <AppText size="md">{t('booking.reason', { reason: b.cancelReason })}</AppText> : null}
          <AppText size="md">{b.refundPaise > 0 ? t('booking.refunded', { amount: rupees(b.refundPaise) }) : t('booking.noRefund')}</AppText>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  status: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  lavender: { backgroundColor: c.lavender },
  peach: { backgroundColor: c.peach },
  mint: { backgroundColor: c.mint },
  mintLight: { backgroundColor: c.mintLight },
  white: { backgroundColor: c.white },
  actions: { gap: space.sm },
});
