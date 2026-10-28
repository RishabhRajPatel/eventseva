// Cars and rentals: the 6-digit code the customer reads out to the vendor at one step (the car
// handover, the rental delivery, or the return). Each step has its own code, valid for 30 minutes and
// once only; "New code" makes a fresh one and the old one stops working.
import { StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { api } from '../lib/api';
import { clockTime } from '../lib/time';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Card } from './Bits';
import { Button } from './Button';

/** Until the return has been counted: after that there is nothing left to confirm in person. */
const OPEN_STAGES = ['confirmed', 'preparing', 'assigned', 'ready', 'dispatched', 'delivered', 'in_progress'];

export const showsHandoverCode = (b: Booking) =>
  b.status === 'confirmed' && (b.bookingType === 'transport' || b.bookingType === 'rental') && OPEN_STAGES.includes(b.stage);

export function HandoverCodeCard({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  // The step changes as the booking moves on (handover → return), so ask again with the stage.
  const code = useQuery({
    queryKey: ['handover-code', booking.id, booking.stage],
    queryFn: () => api.handoverCode(booking.id),
    staleTime: 25 * 60_000,
    // A new code when this one expires (between 30 s and 30 min: a wrong phone clock never spins it).
    refetchInterval: (q) => (q.state.data ? Math.min(Math.max(Date.parse(q.state.data.expiresAt) - Date.now(), 30_000), 30 * 60_000) : false),
  });
  if (!code.data) return null;
  const { phase, expiresAt } = code.data;
  return (
    <Card style={styles.card}>
      <AppText variant="bold" size="md">{t(`handoverCode.title_${phase}`)}</AppText>
      <AppText testID="handover-code" style={styles.code} accessibilityLabel={code.data.code.split('').join(' ')}>
        {code.data.code}
      </AppText>
      <AppText size="sm" color={c.textMuted}>{t('handoverCode.validUntil', { time: clockTime(expiresAt, lang) })}</AppText>
      <AppText size="sm" color={c.textMuted}>{t('handoverCode.body')}</AppText>
      <Button testID="handover-code-new" variant="ghost" size="md" icon="clock" label={t('handoverCode.newCode')} onPress={() => code.refetch()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  code: { fontSize: 32, letterSpacing: 8, fontWeight: '700', color: c.primary },
});
