import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatDay, formatPhone, rupees, todayIst, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { isCancellable, remaining } from '../lib/bookings';
import { slotHours, slotLabel, timeLeftLabel, unitLabel } from '../lib/labels';
import { c, space } from '../lib/theme';
import { useBookingActions } from '../hooks/useBookingActions';
import { useLang } from '../hooks/useLang';
import { BookingBadge, Detail } from './BookingCard';
import { Button, LinkButton } from './Button';
import { Card, CardHeader } from './Card';
import { MoneyBreakdown } from './MoneyBreakdown';
import { Notice } from './Notice';
import { ReasonSheet } from './ReasonSheet';
import { RequestActions } from './RequestActions';
import { TripCard } from './TripCard';
import { Txt } from './Txt';
import { openLink } from '../lib/links';
import { RentalPanel } from './RentalPanel';
import { ChangesPanel } from './ChangesPanel';
import { EngineDetails } from './EngineDetails';
import { TripPanel } from './TripPanel';
import { CashPanel } from './CashPanel';

/** Everything about one booking and what the vendor can do next. Used full-screen and in the tablet side panel. */
export function BookingDetail({ booking, now }: { booking: Booking; now: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { cancel } = useBookingActions(booking.id);
  const [cancelling, setCancelling] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Reuses the chat with this customer, or starts one from the booking.
  async function openChat() {
    setChatError(null);
    setOpeningChat(true);
    try {
      const id = booking.conversationId ?? (await api.post<{ id: string }>('/v1/conversations', { bookingId: booking.id })).id;
      router.push(`/chat/${id}`);
    } catch (e) {
      setChatError(errorText(t, e));
    } finally {
      setOpeningChat(false);
    }
  }
  const respondLeft = booking.status === 'requested' ? remaining(booking.respondBy, now) : null;
  const phone = booking.customer?.phone;

  return (
    <View style={{ gap: space.lg }} testID="booking-detail">
      <Card style={{ gap: space.md }}>
        <View style={styles.head}>
          <Txt variant="display" size="xl" style={{ flex: 1 }}>
            {booking.event.title}
          </Txt>
          <BookingBadge booking={booking} now={now} />
        </View>
        <View style={styles.grid}>
          {booking.startsAt && booking.endsAt ? (
            <>
              <Detail label={t('booking.from')} value={formatDateTime(booking.startsAt, lang)} />
              <Detail label={t('booking.until')} value={formatDateTime(booking.endsAt, lang)} />
            </>
          ) : (
            <>
              <Detail label={t('booking.date')} value={formatDay(booking.day, lang, true)} />
              <Detail label={t('booking.slot')} value={`${slotLabel(t, booking.slot)} · ${slotHours(t, booking.slot)}`} />
            </>
          )}
          <Detail label={t('booking.item')} value={booking.item.title} />
          {booking.bookingType === 'slot' ? (
            <Detail label={t('booking.quantity')} value={booking.item.unit === 'per_event' || booking.item.unit === 'package' ? '1' : `${booking.quantity} · ${unitLabel(t, booking.item.unit)}`} />
          ) : null}
          <Detail label={t('booking.event')} value={t(`eventType.${booking.event.eventType}`)} />
          <Detail label={t('booking.customer')} value={booking.customer?.name ?? t('booking.customerFallback')} />
          {booking.event.guestCount ? <Detail label={t('booking.guests')} value={String(booking.event.guestCount)} /> : null}
          {booking.event.venueAddress ? <Detail label={t('booking.venue')} value={booking.event.venueAddress} /> : null}
        </View>
        {booking.note ? <Notice tone="plain">{`“${booking.note}”`}</Notice> : null}
      </Card>

      <TripCard booking={booking} />

      {booking.bookingType === 'rental' ? <RentalPanel booking={booking} /> : null}
      {booking.bookingType === 'transport' ? <TripPanel booking={booking} /> : null}
      <EngineDetails booking={booking} />
      <ChangesPanel booking={booking} />
      {booking.payMode === 'cash' && booking.status === 'requested' ? (
        <Notice icon="rupee" tone="warning" title={t('cash.requestTitle')}>{t('cash.requestBody')}</Notice>
      ) : null}
      {booking.payMode === 'cash' && !['requested', 'accepted', 'rejected', 'expired'].includes(booking.status) ? <CashPanel booking={booking} /> : null}

      <Card>
        <CardHeader title={t('money.title')} />
        <MoneyBreakdown booking={booking} full />
        {booking.refundPaise > 0 ? (
          <Txt size="sm" color={c.textMuted}>
            {t('money.refunded', { amount: rupees(booking.refundPaise) })}
          </Txt>
        ) : null}
      </Card>

      {['confirmed', 'completed'].includes(booking.status) && booking.bookingType !== 'slot' ? (
        <View style={styles.invoices}>
          <LinkButton testID="open-invoice" label={t('invoice.open')} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: booking.id } })} />
          <LinkButton testID="open-commission-invoice" label={t('invoice.openCommission')} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: booking.id, kind: 'commission' } })} />
        </View>
      ) : null}

      {booking.status === 'requested' && respondLeft ? (
        <Card style={{ gap: space.md }}>
          <Notice icon="clock" tone="warning">
            {t('requests.answerWithin', { time: timeLeftLabel(t, respondLeft) })}
          </Notice>
          <RequestActions bookingId={booking.id} booking={booking} />
        </Card>
      ) : null}

      {booking.status === 'accepted' && booking.payBy ? (
        <Notice icon="clock" tone="info" title={t('requests.waitingPaymentTitle')}>
          {t('requests.waitingPaymentBody', { time: formatDateTime(booking.payBy, lang) })}
        </Notice>
      ) : null}

      {booking.status === 'confirmed' ? (
        <Card>
          <CardHeader title={t('booking.customerContact')} />
          <Txt size="lg" variant="bold">
            {booking.customer?.name ?? t('booking.customerFallback')}
          </Txt>
          {phone ? (
            <>
              <Txt size="md">{formatPhone(phone)}</Txt>
              <Button testID="call" icon="phone" label={t('booking.call')} onPress={() => void openLink(`tel:${phone}`)} />
            </>
          ) : null}
        </Card>
      ) : (booking.status === 'requested' || booking.status === 'accepted') ? (
        <Notice icon="lock">{t('booking.phoneAfterConfirm')}</Notice>
      ) : null}

      {['requested', 'accepted', 'confirmed', 'completed'].includes(booking.status) ? (
        <>
          <Button testID="chat-customer" kind="secondary" icon="chat" label={t('booking.chat')} loading={openingChat} onPress={openChat} />
          {chatError ? <Notice tone="warning">{chatError}</Notice> : null}
        </>
      ) : null}

      {booking.cancelReason ? (
        <Notice tone="plain" title={t('booking.reason')}>
          {booking.cancelReason}
        </Notice>
      ) : null}

      {isCancellable(booking, todayIst()) && ['awaiting_payment', 'pending_confirmation', 'confirmed', 'preparing'].includes(booking.stage) ? (
        <Button testID="cancel-booking" kind="dangerOutline" label={t('booking.cancel')} onPress={() => setCancelling(true)} />
      ) : null}
      <LinkButton label={t('booking.reportProblem')} onPress={() => router.push({ pathname: '/help', params: { bookingId: booking.id } })} />

      <ReasonSheet
        visible={cancelling}
        title={t('booking.cancelTitle')}
        message={booking.payMode === 'cash' && booking.status === 'confirmed' ? t('cash.cancelBody')
          : booking.status === 'confirmed' ? t('booking.cancelBodyPaid', { amount: rupees(booking.advancePaise) }) : t('booking.cancelBodyUnpaid')}
        quickReasons={[t('reason.emergency'), t('reason.equipment'), t('reason.health'), t('reason.doubleBooked')]}
        confirmLabel={t('booking.cancelConfirm')}
        loading={cancel.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => {
          if (!cancel.isPending) cancel.mutate(reason, { onSuccess: () => setCancelling(false) });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  invoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
});
