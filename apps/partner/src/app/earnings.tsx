import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, todayIst, type Earnings } from '@eventseva/app-shared';
import { monthOf, shiftMonth } from '../lib/calendar';
import { useEarnings } from '../lib/queries';
import { c, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { BankCard } from '../components/Banners';
import { Card, Row, Section } from '../components/Card';
import { Pill, type Tone } from '../components/Chip';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';
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
    <Screen back title={t('earnings.title')} refreshing={earnings.isRefetching} onRefresh={() => void earnings.refetch()} testID="earnings">
      <View style={{ alignSelf: 'center' }}>
        <MonthSwitcher month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} canNext={month < shiftMonth(thisMonth, 12)} />
      </View>
      <QueryView query={earnings}>{(e) => <EarningsBody e={e} />}</QueryView>
    </Screen>
  );
}

function EarningsBody({ e }: { e: Earnings }) {
  const { t } = useTranslation();
  const lang = useLang();
  const sum = (statuses: PayoutStatus[]) => e.payouts.filter((p) => statuses.includes(p.status)).reduce((s, p) => s + p.amountPaise, 0);
  return (
    <>
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
          <Txt variant="bold" size="xl">
            {rupees(sum(['scheduled', 'processing']))}
          </Txt>
          <Txt size="sm">{t('earnings.upcomingPayout')}</Txt>
        </View>
        <View style={[styles.tile, { backgroundColor: c.mint }]}>
          <Txt variant="bold" size="xl">
            {rupees(sum(['paid']))}
          </Txt>
          <Txt size="sm">{t('earnings.received')}</Txt>
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
      <Section title={t('earnings.payouts')}>
        <Card style={{ paddingVertical: space.xs }}>
          {e.payouts.length ? (
            e.payouts.map((p, i) => (
              <Row key={p.id} first={i === 0} onPress={() => router.push(`/booking/${p.bookingId}`)} testID={`payout-${p.id}`}>
                <View style={{ flex: 1, paddingVertical: space.sm }}>
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
              </Row>
            ))
          ) : (
            <View style={{ paddingVertical: space.md }}>
              <Txt size="md">{t('earnings.noPayouts')}</Txt>
            </View>
          )}
        </Card>
      </Section>
      <Notice icon="clock">{t('earnings.payoutRule')}</Notice>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: c.royal, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
  tiles: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, borderRadius: radius.lg, padding: 14, gap: 2 },
});
