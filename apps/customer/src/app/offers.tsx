// Offers: every public coupon, opened from the Home banner. No clipboard library is installed, so the
// code is shown large to type in at payment.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { rupees, type Offer } from '@eventseva/app-shared';
import { c, radius, space } from '../lib/theme';
import { useOffers } from '../hooks/useCatalog';
import { AppText } from '../components/AppText';
import { Card, Pill } from '../components/Bits';
import { Button } from '../components/Button';
import { useValidTill } from '../components/Coupons';
import { Icon, type IconName } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { CardsSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';

const renderOffer = ({ item }: { item: Offer }) => <OfferCard offer={item} />;
const Separator = () => <View style={styles.separator} />;

export default function OffersScreen() {
  const { t } = useTranslation();
  const offers = useOffers();

  let body;
  if (offers.isPending) body = <CardsSkeleton count={3} height={200} />;
  else if (offers.error) body = <ErrorState error={offers.error} onRetry={() => offers.refetch()} />;
  else {
    body = (
      <FlashList
        data={offers.data.items}
        keyExtractor={(o) => o.code}
        renderItem={renderOffer}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="star"
            title={t('offers.emptyTitle')}
            body={t('offers.emptyBody')}
            actions={<Button label={t('events.findVendors')} onPress={() => router.navigate('/search')} />}
          />
        }
      />
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('offers.title')} subtitle={t('offers.subtitle')} />
      {body}
    </Screen>
  );
}

const OfferCard = memo(function OfferCard({ offer: o }: { offer: Offer }) {
  const { t } = useTranslation();
  const validTill = useValidTill()(o);
  const terms: { icon: IconName; text: string }[] = [];
  if (o.minAmountPaise > 0) terms.push({ icon: 'check', text: t('offers.minAmount', { amount: rupees(o.minAmountPaise) }) });
  if (o.category) terms.push({ icon: 'check', text: t('offers.category', { category: o.category.name }) });
  if (o.firstBookingOnly) terms.push({ icon: 'user', text: t('offers.firstBooking') });
  if (validTill) terms.push({ icon: 'clock', text: validTill });

  return (
    <Card style={styles.card}>
      <Pill label={o.title} tone="peach" />
      <AppText variant="display" size="xl">
        {o.summary}
      </AppText>
      <View style={styles.code} accessible accessibilityLabel={`${o.code}. ${t('offers.useAtPayment')}`}>
        <AppText variant="bold" size="display" color={c.royal} selectable style={styles.codeText}>
          {o.code}
        </AppText>
        <AppText size="sm" align="center">
          {t('offers.useAtPayment')}
        </AppText>
      </View>
      {terms.map((term) => (
        <View key={term.text} style={styles.term}>
          <Icon name={term.icon} size={16} color={c.royal} />
          <AppText size="sm" style={styles.flex}>
            {term.text}
          </AppText>
        </View>
      ))}
    </Card>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: space.xxxl },
  separator: { height: space.md },
  card: { padding: space.lg, gap: space.md },
  code: {
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.royal,
    backgroundColor: c.lavender,
  },
  codeText: { letterSpacing: 2 },
  term: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
