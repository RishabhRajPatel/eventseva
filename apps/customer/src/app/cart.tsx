// The cart: services from several vendors for one event, priced together and booked in one go —
// all of them or none. Each vendor still accepts their own request; nothing is paid now.
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, formatDateTime, rupees } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { cart, missingBundleServices, useCart } from '../lib/cart';
import { newKey } from '../lib/engine';
import { errorText } from '../lib/errors';
import { keys } from '../lib/queryClient';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from '../components/AppText';
import { Card, Divider, MoneyRow, Notice, Pill } from '../components/Bits';
import { Button } from '../components/Button';
import { Screen, ScreenHeader } from '../components/Screen';
import { EmptyState } from '../components/States';
import { useToast } from '../components/Toast';

export default function CartScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const { items, bundle } = useCart();
  const requests = items.map((i) => i.request);
  const json = JSON.stringify({ requests, bundle: bundle?.id });
  const quote = useQuery({
    queryKey: ['checkoutQuote', json],
    queryFn: () => api.checkoutQuote(requests, bundle?.id),
    enabled: items.length > 0,
    retry: false,
  });
  // A package needs its "always included" services in the same checkout.
  const bundleInfo = useQuery({ queryKey: ['bundles', bundle?.vendorId], queryFn: () => api.bundles(bundle!.vendorId), enabled: !!bundle });
  const bundleServices = useQuery({ queryKey: ['engineServices', bundle?.vendorId], queryFn: () => api.engineServices(bundle!.vendorId), enabled: !!bundle });
  const bundleItems = bundleInfo.data?.items.find((b) => b.id === bundle?.id)?.items ?? [];
  const missing = bundle ? missingBundleServices(bundleItems, items) : [];
  const titleOf = (serviceId: string) => bundleServices.data?.items.find((x) => x.id === serviceId)?.title ?? t('engineBook.service');
  // Which line the server refused (it says itemIndex).
  const badIndex = quote.error instanceof ApiError && typeof quote.error.details.itemIndex === 'number' ? quote.error.details.itemIndex : null;

  const keyRef = useRef({ body: '', key: newKey('cart') });
  const [error, setError] = useState<string | null>(null);
  const book = useMutation({
    mutationFn: () => {
      if (keyRef.current.body !== json) keyRef.current = { body: json, key: newKey('cart') };
      return api.checkout(requests, bundle?.id, keyRef.current.key);
    },
    onSuccess: (result) => {
      cart.clear();
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('cart.booked', { count: result.bookings.length }));
      router.replace('/bookings');
    },
    onError: (e) => setError(errorText(t, e)),
  });

  if (!items.length) {
    return (
      <Screen>
        <ScreenHeader title={t('cart.title')} />
        <EmptyState icon="searchEmpty" title={t('cart.empty')} body={t('cart.emptyBody')} actions={<Button label={t('cart.browse')} onPress={() => router.navigate('/search')} />} />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={
        <>
          {error ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : (
            <AppText size="sm" align="center">
              {t('cart.allOrNone')}
            </AppText>
          )}
          <Button
            testID="checkout"
            label={quote.data ? t('cart.sendAll', { count: items.length }) : t('cart.sendAllShort')}
            loadingLabel={t('book.sending')}
            disabled={!quote.data || missing.length > 0}
            onPress={async () => {
              setError(null);
              await book.mutateAsync();
            }}
          />
        </>
      }
    >
      <ScreenHeader title={t('cart.title')} subtitle={t('cart.subtitle', { count: items.length })} />
      {bundle ? (
        <Notice icon="star" tone="mint">
          {bundle.discountPercent ? t('cart.bundleOff', { name: bundle.name, n: bundle.discountPercent }) : t('cart.bundle', { name: bundle.name })}
        </Notice>
      ) : null}
      {bundle && missing.length ? (
        <Card style={styles.card}>
          <AppText variant="bold" size="sm">{t('cart.bundleMissing')}</AppText>
          {missing.map((serviceId) => (
            <Button
              key={serviceId}
              label={t('cart.addService', { name: titleOf(serviceId) })}
              variant="outline"
              size="md"
              onPress={() => router.push({ pathname: '/vendor/[id]/engine', params: { id: bundle.vendorId, service: serviceId, bundle: bundle.id } })}
            />
          ))}
        </Card>
      ) : null}
      {items.map((item, index) => {
        const q = quote.data?.items[index];
        return (
          <Card key={item.key} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <AppText variant="bold" size="md">{item.serviceTitle}</AppText>
                <AppText size="sm">{item.vendorName}</AppText>
                <AppText size="xs" color={c.textMuted}>
                  {formatDateTime(item.request.startsAt, lang)}
                  {item.request.endsAt ? ` → ${formatDateTime(item.request.endsAt, lang)}` : ''}
                </AppText>
              </View>
              {q ? <AppText variant="bold" size="md">{rupees(q.totalPaise)}</AppText> : null}
            </View>
            {q?.priceKind === 'indicative' ? <Pill label={t('cart.indicative')} tone="peach" /> : null}
            {badIndex === index ? <AppText size="sm" color={c.danger}>{errorText(t, quote.error)}</AppText> : null}
            <Button label={t('cart.remove')} variant="ghost" size="md" onPress={() => cart.remove(item.key)} />
          </Card>
        );
      })}
      {quote.error && badIndex === null ? <AppText size="sm" color={c.danger}>{errorText(t, quote.error)}</AppText> : null}
      {quote.data ? (
        <Card style={styles.card}>
          <MoneyRow label={t('rent.total')} value={rupees(quote.data.totalPaise)} strong />
          <MoneyRow label={t('cart.advances')} value={rupees(quote.data.advancePaise)} accent />
          {quote.data.depositPaise ? <MoneyRow label={t('rent.depositTotal')} value={rupees(quote.data.depositPaise)} /> : null}
          <Divider />
          <AppText size="xs" color={c.textMuted}>{t('cart.payLater')}</AppText>
        </Card>
      ) : null}
      <Button label={t('cart.clear')} variant="dangerOutline" size="md" onPress={() => cart.clear()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1, gap: 2 },
});
