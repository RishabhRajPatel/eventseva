// Pay advance (Payment board). Razorpay checkout in real builds; a labelled test button in development.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, timeLeft } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { choosePaymentPath, payAdvance, type PayMethod } from '../../lib/payments';
import { keys } from '../../lib/queryClient';
import { useMe } from '../../lib/session';
import { c, radius, space } from '../../lib/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { useNow } from '../../hooks/useNow';
import { AppText } from '../../components/AppText';
import { Card, Divider, MoneyRow, Notice } from '../../components/Bits';
import { Button } from '../../components/Button';
import { CouponBox, CouponMoneyRows } from '../../components/Coupons';
import { OptionTile } from '../../components/Form';
import { Icon } from '../../components/Icon';
import { Screen, ScreenHeader } from '../../components/Screen';
import { ErrorState, Loading } from '../../components/States';

const METHODS: PayMethod[] = ['upi', 'card', 'netbanking'];

export default function PayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const me = useMe();
  const qc = useQueryClient();
  const now = useNow();
  const path = choosePaymentPath();
  const [method, setMethod] = useState<PayMethod>('upi');
  const [message, setMessage] = useState<string | null>(null);
  const booking = useQuery({ queryKey: keys.booking(id), queryFn: () => api.booking(id) });

  const pay = useMutation({
    mutationFn: () => payAdvance(booking.data!, { name: me.name, phone: me.phone, method }, path),
    onMutate: () => setMessage(null),
    onSuccess: (result) => {
      if (result.status === 'cancelled') return setMessage(t('payment.cancelled'));
      qc.setQueryData(keys.booking(id), result.booking);
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      router.replace({ pathname: '/booking/[id]', params: { id } });
    },
    onError: (e) => setMessage(errorText(t, e)),
  });

  if (booking.isPending) return <Loading />;
  if (booking.error) {
    return (
      <Screen>
        <ScreenHeader title={t('payment.title')} />
        <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
      </Screen>
    );
  }
  const b = booking.data;
  const time = b.payBy ? timeLeft(b.payBy, now) : null;
  const payable = b.status === 'accepted' && time != null;

  return (
    <Screen
      scroll
      keyboard
      footer={
        payable ? (
          <>
            {message ? (
              <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
                {message}
              </AppText>
            ) : null}
            {path === 'dev' ? (
              <>
                <Button label={t('payment.devButton')} variant="dark" onPress={() => pay.mutate()} loading={pay.isPending} />
                <AppText size="xs" align="center">
                  {t('payment.devNote')}
                </AppText>
              </>
            ) : (
              <>
                <Button label={t('payment.pay', { amount: rupees(b.payNowPaise) })} onPress={() => pay.mutate()} loading={pay.isPending} />
                <View style={styles.secure}>
                  <Icon name="lock" size={14} />
                  <AppText size="xs">{t('payment.secure')}</AppText>
                </View>
              </>
            )}
          </>
        ) : (
          <Button label={t('payment.viewBooking')} variant="outline" onPress={() => router.replace({ pathname: '/booking/[id]', params: { id } })} />
        )
      }
    >
      <ScreenHeader title={t('payment.title')} />
      {b.status === 'accepted' ? (
        <Notice icon="checkCircle" tone="mint">
          <AppText size="md">
            <AppText variant="bold" size="md">
              {b.vendor.businessName}
            </AppText>
            {` ${t('payment.accepted')}`}
          </AppText>
        </Notice>
      ) : (
        <Notice icon="alert" tone="peach">
          {b.status === 'confirmed' ? t('payment.alreadyPaid') : t('payment.notPayable')}
        </Notice>
      )}

      <Card style={styles.card}>
        <View style={styles.line}>
          <AppText size="md" style={styles.flex}>
            {b.event.title}
          </AppText>
          <AppText size="md">{`${formatDay(b.day, lang).replace(/ \d{4}$/, '')} · ${t(`slots.${b.slot}.label`)}`}</AppText>
        </View>
        <MoneyRow label={b.quantity > 1 ? `${b.item.title} × ${b.quantity}` : b.item.title} value={rupees(b.amountPaise)} />
        <Divider />
        {b.discountPaise > 0 ? <CouponMoneyRows booking={b} /> : <MoneyRow label={t('payment.advanceNow')} value={rupees(b.advancePaise)} strong accent />}
        <MoneyRow label={t('payment.balanceAfter')} value={rupees(b.balancePaise)} small />
      </Card>

      {payable ? <CouponBox booking={b} /> : null}

      {payable && time ? (
        <AppText size="sm" accessibilityLiveRegion="polite">
          {t('booking.payWithin', { time })}
        </AppText>
      ) : null}

      {payable && path === 'razorpay' ? (
        <View style={styles.methods} accessibilityRole="radiogroup" accessibilityLabel={t('payment.how')}>
          <AppText variant="bold" size={14}>
            {t('payment.how')}
          </AppText>
          {METHODS.map((m) => (
            <OptionTile key={m} label={t(`payment.methods.${m}`)} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
      ) : null}

      <View style={styles.policy}>
        <AppText size="sm">
          <AppText variant="bold" size="sm">
            {t('payment.policyTitle')}
          </AppText>
          {` ${t('payment.policy')}`}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space.lg, gap: 10 },
  line: { flexDirection: 'row', gap: space.md },
  methods: { gap: space.sm },
  policy: { borderRadius: radius.md, backgroundColor: c.peach, paddingVertical: space.md, paddingHorizontal: space.lg },
  secure: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
});
