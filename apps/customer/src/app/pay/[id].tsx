// Pay advance (Payment board). Razorpay checkout in real builds; a labelled test button in development.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, timeLeft } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { choosePaymentPath, payAdvance, type PayMethod, type PayStage } from '../../lib/payments';
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
import { PayTogetherCard } from '../../components/PayTogetherCard';
import { Icon } from '../../components/Icon';
import { Screen, ScreenHeader } from '../../components/Screen';
import { CardsSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/States';
import { useToast } from '../../components/Toast';

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
  const toast = useToast();
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [stage, setStage] = useState<PayStage | 'confirmed' | null>(null);
  const booking = useQuery({ queryKey: keys.booking(id), queryFn: () => api.booking(id) });

  const pay = useMutation({
    mutationFn: () => payAdvance(booking.data!, { name: me.name, phone: me.phone, method }, path, setStage),
    onMutate: () => setMessage(null),
    onSuccess: (result) => {
      if (result.status === 'cancelled') {
        setStage(null);
        return setMessage({ text: t('payment.cancelled'), tone: 'info' });
      }
      setStage('confirmed');
      qc.setQueryData(keys.booking(id), result.booking);
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('payment.done'));
      router.replace({ pathname: '/booking/[id]', params: { id } });
    },
    onError: (e) => {
      setStage(null);
      setMessage({ text: errorText(t, e), tone: 'error' });
    },
  });
  const payNow = () => pay.mutateAsync().then((r) => (r.status === 'paid' ? undefined : null));
  const stageLabel = stage === 'starting' ? t('payment.starting') : stage === 'checkout' ? t('payment.inCheckout') : stage === 'verifying' ? t('payment.verifying') : undefined;

  if (booking.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('payment.title')} />
        <CardsSkeleton count={2} height={150} />
      </Screen>
    );
  }
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
              <AppText size="sm" color={message.tone === 'error' ? c.danger : c.royal} align="center" accessibilityLiveRegion="assertive">
                {message.text}
              </AppText>
            ) : null}
            {path === 'dev' ? (
              <>
                <Button label={t('payment.devButton')} variant="dark" onPress={payNow} loadingLabel={stageLabel} />
                <AppText size="xs" align="center">
                  {t('payment.devNote')}
                </AppText>
              </>
            ) : (
              <>
                <Button label={t('payment.pay', { amount: rupees(b.payNowPaise) })} onPress={payNow} loadingLabel={stageLabel} />
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
      {stage === 'verifying' ? (
        <Notice icon="clock" tone="lavender">
          {t('payment.verifyingNote')}
        </Notice>
      ) : stage === 'confirmed' ? (
        <Notice icon="checkCircle" tone="mint">
          {t('payment.done')}
        </Notice>
      ) : b.status === 'accepted' ? (
        <Notice icon="checkCircle" tone="mint">
          <AppText size="md">
            <AppText variant="bold" size="md">
              {b.vendor.businessName}
            </AppText>
            {` ${t('payment.accepted')}`}
          </AppText>
        </Notice>
      ) : (
        <Notice icon={b.status === 'confirmed' ? 'checkCircle' : 'alert'} tone={b.status === 'confirmed' ? 'mint' : 'peach'}>
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

      {payable ? <PayTogetherCard booking={b} path={path} method={method} /> : null}

      {payable ? <CouponBox booking={b} /> : null}

      {payable && time ? (
        <AppText size="sm" accessibilityLiveRegion="polite">
          {t('booking.payWithin', { time })}
        </AppText>
      ) : null}

      {payable && path === 'razorpay' ? (
        <View style={styles.methods} accessibilityRole="radiogroup" accessibilityLabel={t('payment.how')}>
          <AppText variant="bold" size="sm">
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
