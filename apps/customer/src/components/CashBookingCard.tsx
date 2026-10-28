// Cash bookings on the booking page: what to pay the vendor in person, and the cash the vendor
// recorded (the customer is told each time and can report a mistake).
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Card, MoneyRow, Notice } from './Bits';
import { Button } from './Button';

export function CashBookingCard({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const open = !['requested', 'rejected', 'expired'].includes(booking.status);
  const cash = useQuery({ queryKey: ['cash', booking.id], queryFn: () => api.cash(booking.id), enabled: open });
  if (!open) {
    return <Notice icon="alert" tone="lavender">{t('cash.requested')}</Notice>;
  }
  if (!cash.data) return null;
  const s = cash.data;
  return (
    <Card style={styles.card}>
      <AppText variant="bold" size="md">{t('cash.title')}</AppText>
      <AppText size="sm">{t('cash.payVendor', { amount: rupees(s.amountPaise) })}</AppText>
      <MoneyRow label={t('cash.received')} value={rupees(s.receivedPaise)} />
      {s.depositPaise ? <MoneyRow label={t('cash.depositHeld')} value={rupees(s.depositHeldPaise)} small /> : null}
      {s.receipts.map((r) => (
        <View key={r.id} style={styles.line}>
          <AppText size="sm" style={styles.flex}>{t(`cash.kind.${r.kind}`)} · {formatDateTime(r.createdAt, lang)}</AppText>
          <AppText size="sm" variant="bold">{['refund', 'deposit_return'].includes(r.kind) ? '−' : ''}{rupees(r.amountPaise)}</AppText>
        </View>
      ))}
      <AppText size="xs" color={c.textMuted}>{t('cash.wrongHint')}</AppText>
      <Button label={t('cash.report')} variant="outline" size="md" onPress={() => router.push({ pathname: '/help', params: { bookingId: booking.id } })} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
