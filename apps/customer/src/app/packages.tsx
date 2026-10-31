// EventSeva packages: services from several vendors sold together. Booking one puts the whole
// package in the cart's hands — the checkout makes every booking or none, and refuses to go ahead
// without the services marked "always included".
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { rupees, type CuratedPackage, type EventType } from '@eventseva/app-shared';
import { c, space } from '../lib/theme';
import { cart } from '../lib/cart';
import { usePackages } from '../hooks/useCatalog';
import { AppText } from '../components/AppText';
import { Card, Notice, Pill } from '../components/Bits';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { CardsSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';

const Separator = () => <View style={styles.separator} />;

/**
 * What the package costs before anyone picks dates: the listed prices, less the package discount.
 * Rounded to whole paise — money is always an integer here, and a fraction would print as ₹8.8088.
 */
export function packageFromPaise(p: CuratedPackage): number {
  const listed = p.services.reduce((sum, s) => sum + s.pricePaise, 0);
  return Math.round((listed * (100 - p.discountPercent)) / 100);
}

export default function PackagesScreen() {
  const { t } = useTranslation();
  // Opened from an event, so the package lands in that event's cart.
  const { eventId, eventType } = useLocalSearchParams<{ eventId?: string; eventType?: string }>();
  const packages = usePackages(eventType as EventType | undefined);

  let body;
  if (packages.isPending) body = <CardsSkeleton count={3} height={220} />;
  else if (packages.error) body = <ErrorState error={packages.error} onRetry={() => packages.refetch()} />;
  else {
    body = (
      <FlashList
        data={packages.data.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PackageCard pkg={item} eventId={eventId} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="searchEmpty"
            title={t('packages.emptyTitle')}
            body={t('packages.emptyBody')}
            actions={<Button label={t('packages.browse')} onPress={() => router.navigate('/search')} />}
          />
        }
      />
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('packages.title')} subtitle={t('packages.subtitle')} />
      {body}
    </Screen>
  );
}

const PackageCard = memo(function PackageCard({ pkg: p, eventId }: { pkg: CuratedPackage; eventId?: string }) {
  const { t } = useTranslation();
  const total = packageFromPaise(p);

  /**
   * Start the package: remember it on the cart, then open the first required service. The cart
   * screen then lists whatever the package still needs, each with its own vendor.
   */
  function start() {
    const first = p.services.find((s) => s.mandatory) ?? p.services[0];
    if (!first) return;
    cart.setBundle({ id: p.id, vendorId: null, name: p.name, discountPercent: p.discountPercent, serviceIds: p.services.map((s) => s.serviceId) });
    router.push({
      pathname: '/vendor/[id]/engine',
      params: { id: first.vendorId, service: first.serviceId, bundle: p.id, ...(eventId ? { event: eventId } : {}) },
    });
  }

  return (
    <Card
      style={styles.card}
      label={t('packages.cardLabel', { name: p.name, count: p.services.length, price: rupees(total) })}
    >
      <View style={styles.head}>
        <AppText variant="display" size="xl" style={styles.flex}>
          {p.name}
        </AppText>
        {p.discountPercent ? <Pill label={t('packages.discount', { percent: p.discountPercent })} tone="mint" /> : null}
      </View>
      {p.description ? <AppText size="sm">{p.description}</AppText> : null}

      {p.services.map((s) => (
        <View key={s.serviceId} style={styles.service}>
          <Icon name={s.mandatory ? 'check' : 'star'} size={16} color={c.royal} />
          <View style={styles.flex}>
            <AppText variant="bold" size="sm">
              {s.title}
            </AppText>
            <AppText size="sm" color={c.textMuted}>
              {s.vendorName} · {rupees(s.pricePaise)} · {s.mandatory ? t('packages.included') : t('packages.optional')}
            </AppText>
          </View>
        </View>
      ))}

      <AppText variant="bold" size="md">
        {t('packages.total', { amount: rupees(total) })}
      </AppText>

      {p.available ? (
        <Button label={t('packages.book')} onPress={start} />
      ) : (
        <Notice icon="alert" tone="peach">
          {t('packages.unavailableBody')}
        </Notice>
      )}
    </Card>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: space.xxxl },
  separator: { height: space.md },
  card: { padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  service: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
