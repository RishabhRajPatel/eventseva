// Cars and rentals: the 6-digit code the customer reads out to the vendor at the handover or
// delivery and at the return. The vendor entering it shows the customer was there and agreed.
import { StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Card } from './Bits';

/** Until the return has been counted: after that there is nothing left to confirm in person. */
const OPEN_STAGES = ['confirmed', 'preparing', 'assigned', 'ready', 'dispatched', 'delivered', 'in_progress'];

export const showsHandoverCode = (b: Booking) =>
  b.status === 'confirmed' && (b.bookingType === 'transport' || b.bookingType === 'rental') && OPEN_STAGES.includes(b.stage);

export function HandoverCodeCard({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const code = useQuery({ queryKey: ['handover-code', booking.id], queryFn: () => api.handoverCode(booking.id), staleTime: Infinity });
  if (!code.data) return null;
  return (
    <Card style={styles.card}>
      <AppText variant="bold" size="md">{t('handoverCode.title')}</AppText>
      <AppText testID="handover-code" style={styles.code} accessibilityLabel={code.data.code.split('').join(' ')}>
        {code.data.code}
      </AppText>
      <AppText size="sm" color={c.textMuted}>{t('handoverCode.body')}</AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  code: { fontSize: 32, letterSpacing: 8, fontWeight: '700', color: c.primary },
});
