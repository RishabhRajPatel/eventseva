import { memo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, todayIst, type Earnings } from '@eventseva/app-shared';
import { monthOf, shiftMonth } from '../lib/calendar';
import { useEarnings } from '../lib/queries';
import { c, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { BankCard } from '../components/Banners';
import { Card, Row } from '../components/Card';
import { Pill, type Tone } from '../components/Chip';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { EmptyInline, QueryView } from '../components/States';
import { Txt } from '../components/Txt';

type PayoutStatus = Earnings['payouts'][number]['status'];
const PAYOUT_TONE: Record<PayoutStatus, Tone> = { scheduled: 'warning', processing: 'info', paid: 'success', failed: 'danger', held: 'danger' };

/** "Kamai": one month of earnings and payouts (VendorEarnings board). */
export default function EarningsScreen() {
  const { t } = useTranslation();
  const thisMonth = monthOf(todayIst());
  const [month, setMonth] = useState(thisMonth);
  const earnings = useEarnings(month);
  return (
    <Screen back scroll={false} title={t('earnings.title')} testID="earnings">
      <View style={{ alignSelf: 'center' }}>
        <MonthSwitcher month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} canNext={month < shiftMonth(thisMonth, 12)} />
      </View>
      <QueryView query={earnings} padded>
        {(e) => (
          <FlashList
            data={e.payouts}
            keyExtractor={keyOf}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={Gap}
            refreshControl={<RefreshControl refreshing={earnings.isRefetching} onRefresh={() => void earnings.refetch()} colors={[c.royal]} />}
            ListHeaderComponent={<EarningsSummary e={e} />}
            renderItem={({ item }) => <PayoutRow p={item} />}
            ListEmptyComponent={
              <Card>
                <EmptyInline icon="rupee" text={t('earnings.noPayouts')} />
              </Card>
            }
            ListFooterComponent={
              <View style={{ paddingTop: space.lg }}>
                <Notice icon="clock">{t('earnings.payoutRule')}</Notice>
              </View>
            }
          />
        )}
      </QueryView>
    </Screen>
  );
}

type Payout = Earnings['payouts'][number];
const keyOf = (p: Payout) => p.id;
const Gap = () => <View style={styles.gap} />;

/** Month total, upcoming / received, the money breakdown and the bank card, above the payouts. */
function EarningsSummary({ e }: { e: Earnings }) {
  const { t } = useTranslation();
  const sum = (statuses: PayoutStatus[]) => e.payouts.filter((p) => statuses.includes(p.status)).reduce((s, p) => s + p.amountPaise, 0);
  return (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      <View style={styles.hero}>
        <Txt size="sm" color={c.white}>
          {t('earnings.monthEarnings')}
        </Txt>
        <Txt variant="bold" size="display" color={c.white} testID="earnings-total" style={{ fontSize: 32, lineHeight: 40 }}>
          {rupees(e.payoutPaise)}
        </Txt>
        <Txt size="sm" color={c.white}>
          {t('earnings.bookingsLine', { n: e.bookings })}
        </Txt>
      </View>
      <View style={styles.tiles}>
        <View style={[styles.tile, { backgroundColor: c.peach }]}>
          <Txt variant="bold" size="xl" color={c.onWarning}>
            {rupees(sum(['scheduled', 'processing']))}
          </Txt>
          <Txt size="sm" color={c.onWarning}>
            {t('earnings.upcomingPayout')}
          </Txt>
        </View>
        <View style={[styles.tile, { backgroundColor: c.mint }]}>
          <Txt variant="bold" size="xl" color={c.onSuccess}>
            {rupees(sum(['paid']))}
          </Txt>
          <Txt size="sm" color={c.onSuccess}>
            {t('earnings.received')}
          </Txt>
        </View>
      </View>
      <Card>
        <Row first>
          <Txt size="md">{t('earnings.collectAtEvent')}</Txt>
          <Txt variant="bold" size="md">
            {rupees(e.collectAtEventPaise)}
          </Txt>
        </Row>
        <Row>
          <Txt size="md">{t('earnings.gross')}</Txt>
          <Txt size="md">{rupees(e.grossPaise)}</Txt>
        </Row>
        <Row>
          <Txt size="sm" color={c.textMuted}>
            {t('earnings.fee')}
          </Txt>
          <Txt size="sm" color={c.textMuted}>
            {rupees(e.commissionPaise)}
          </Txt>
        </Row>
      </Card>
      <BankCard />
      <Txt variant="display" size="xl">
        {t('earnings.payouts')}
      </Txt>
    </View>
  );
}

const PayoutRow = memo(function PayoutRow({ p }: { p: Payout }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Card onPress={() => router.push(`/booking/${p.bookingId}`)} testID={`payout-${p.id}`} style={styles.payout}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bold" size="md" numberOfLines={1}>
          {p.eventTitle} · {formatDay(p.day, lang)}
        </Txt>
        <Txt size="sm" color={c.textMuted}>
          {p.status === 'paid' ? t('earnings.sent') : t('earnings.arrives', { day: formatDay(todayIst(new Date(p.releaseAfter)), lang) })}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: space.xs }}>
        <Txt variant="bold" size="md">
          {rupees(p.amountPaise)}
        </Txt>
        <Pill label={t(`payoutStatus.${p.status}`)} tone={PAYOUT_TONE[p.status]} />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  gap: { height: space.sm },
  payout: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hero: { backgroundColor: c.royal, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
  tiles: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, borderRadius: radius.lg, padding: 14, gap: 2 },
});
