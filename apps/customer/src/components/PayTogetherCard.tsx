// On the payment screen of a cart booking: when other bookings of the same cart were accepted too,
// one payment covers them all. The server splits it per booking.
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { payCheckout, type PaymentPath, type PayMethod, type PayStage } from '../lib/payments';
import { keys } from '../lib/queryClient';
import { useMe } from '../lib/session';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Card } from './Bits';
import { Button } from './Button';
import { useToast } from './Toast';

export function PayTogetherCard({ booking, path, method }: { booking: Booking; path: PaymentPath; method: PayMethod }) {
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [stage, setStage] = useState<PayStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkoutId = booking.checkoutId;
  const view = useQuery({ queryKey: ['checkout', checkoutId], queryFn: () => api.checkoutView(checkoutId!), enabled: !!checkoutId && booking.status === 'accepted' });
  const pay = useMutation({
    mutationFn: () => payCheckout(checkoutId!, { name: me.name, phone: me.phone, method }, path, setStage),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setStage(null);
      if (r.status === 'cancelled') return setError(t('payment.cancelled'));
      for (const b of r.checkout.bookings) void qc.invalidateQueries({ queryKey: keys.booking(b.id) });
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('payTogether.done', { count: r.checkout.bookings.filter((b) => b.status === 'confirmed').length }));
      router.replace('/bookings');
    },
    onError: (e) => {
      setStage(null);
      setError(errorText(t, e));
    },
  });
  const v = view.data;
  if (!v || v.payableCount < 2) return null;
  const others = v.bookings.filter((b) => b.id !== booking.id && b.status === 'accepted');
  const stageLabel = stage === 'starting' ? t('payment.starting') : stage === 'checkout' ? t('payment.inCheckout') : stage === 'verifying' ? t('payment.verifying') : undefined;
  return (
    <Card style={styles.card}>
      <AppText variant="bold" size="md">{t('payTogether.title', { count: v.payableCount })}</AppText>
      <AppText size="sm">{t('payTogether.body', { names: others.map((b) => b.businessName).join(', ') })}</AppText>
      {error ? <AppText size="sm" color={c.danger} accessibilityLiveRegion="assertive">{error}</AppText> : null}
      <Button
        testID="pay-together"
        variant="outline"
        size="md"
        label={t('payTogether.pay', { amount: rupees(v.payableNowPaise) })}
        loadingLabel={stageLabel}
        onPress={() => pay.mutateAsync().then(() => undefined)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({ card: { padding: space.lg, gap: space.sm } });
