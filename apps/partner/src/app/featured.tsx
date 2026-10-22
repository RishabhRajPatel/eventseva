import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type FeaturedOverview, type FeaturedPlan, type FeaturedPurchase } from '@eventseva/app-shared';
import { buyFeatured, choosePaymentPath, PaymentError } from '../lib/payments';
import { errorCode, errorText } from '../lib/errors';
import { istDay, perDayPaise } from '../lib/labels';
import { keys, useFeatured, useVendor } from '../lib/queries';
import { c, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button } from '../components/Button';
import { Card, Row, Section } from '../components/Card';
import { Pill } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';
import { Txt } from '../components/Txt';

/** "Get featured": buy days at the top of customer search with a Featured badge. */
export default function FeaturedScreen() {
  const { t } = useTranslation();
  const featured = useFeatured();
  return (
    <Screen back title={t('featured.title')} refreshing={featured.isRefetching} onRefresh={() => void featured.refetch()} testID="featured">
      <QueryView query={featured}>{(f) => <FeaturedBody f={f} />}</QueryView>
    </Screen>
  );
}

function FeaturedBody({ f }: { f: FeaturedOverview }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const vendor = useVendor();
  const [path] = useState(choosePaymentPath);
  const [success, setSuccess] = useState<string | null>(null);

  const buy = useMutation({
    mutationFn: (plan: FeaturedPlan) => buyFeatured(plan, { name: vendor.data?.businessName }, path),
    onMutate: () => setSuccess(null),
    onSuccess: (res) => {
      // Closing the checkout is not an error: stay on the screen without a message.
      if (res.status === 'cancelled') return;
      qc.setQueryData(keys.featured, res.overview);
      void qc.invalidateQueries({ queryKey: keys.featured });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.vendor });
      setSuccess(res.overview.featuredUntil ? t('featured.success', { day: istDay(res.overview.featuredUntil, lang) }) : t('featured.successNoDate'));
    },
    onError: (e) => {
      const code = errorCode(e);
      // A plan was switched off or the profile went off-line meanwhile: show the current state.
      if (code === 'PLAN_NOT_FOUND' || code === 'VENDOR_NOT_ACTIVE') void qc.invalidateQueries({ queryKey: keys.featured });
      const message = e instanceof PaymentError ? t('featured.paymentFailed') : code === 'VENDOR_NOT_ACTIVE' ? t('featured.notLive') : errorText(t, e);
      Alert.alert(t('errors.title'), message);
    },
  });
  const buyingId = buy.isPending ? buy.variables?.id : undefined;

  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="star" size={22} color={c.indigo} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt variant="bold" size="lg" color={c.white}>
            {t('featured.headline')}
          </Txt>
          <Txt size="sm" color={c.white}>
            {t('featured.explain')}
          </Txt>
        </View>
      </View>

      {f.featuredUntil ? (
        <View style={[styles.status, { backgroundColor: c.mint }]} testID="featured-status">
          <Icon name="check" size={20} color={c.ink} />
          <View style={{ flex: 1 }}>
            <Txt variant="bold" size="md">
              {t('featured.until', { day: istDay(f.featuredUntil, lang) })}
            </Txt>
            <Txt size="sm">{t('featured.activeNote')}</Txt>
          </View>
        </View>
      ) : (
        <View style={[styles.status, { backgroundColor: c.white }]} testID="featured-status">
          <Icon name="clock" size={20} color={c.textMuted} />
          <View style={{ flex: 1 }}>
            <Txt variant="bold" size="md">
              {t('featured.notFeatured')}
            </Txt>
            <Txt size="sm" color={c.textMuted}>
              {t('featured.notFeaturedNote')}
            </Txt>
          </View>
        </View>
      )}

      {success ? (
        <Notice icon="check" tone="success" testID="featured-success">
          {success}
        </Notice>
      ) : null}
      {!f.canBuy ? (
        <Notice icon="lock" tone="warning" testID="featured-locked">
          {t('featured.notLive')}
        </Notice>
      ) : null}

      <Section title={t('featured.plans')}>
        {f.plans.length ? (
          f.plans.map((p) => (
            <Card key={p.id} testID={`plan-${p.id}`} style={{ gap: space.md }}>
              <View style={styles.planHead}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bold" size="lg">
                    {p.name}
                  </Txt>
                  <Txt size="sm" color={c.textMuted}>
                    {t('featured.days', { count: p.days })}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Txt variant="bold" size="xl" color={c.royal}>
                    {rupees(p.pricePaise)}
                  </Txt>
                  <Txt size="xs" color={c.textMuted}>
                    {t('featured.perDay', { amount: rupees(perDayPaise(p.pricePaise, p.days)) })}
                  </Txt>
                </View>
              </View>
              <Button
                testID={`buy-${p.id}`}
                kind="indigo"
                icon="star"
                label={path === 'dev' ? t('featured.devButton') : t('featured.buy', { amount: rupees(p.pricePaise) })}
                loading={buyingId === p.id}
                disabled={!f.canBuy || buy.isPending}
                onPress={() => {
                  if (f.canBuy && !buy.isPending) buy.mutate(p);
                }}
              />
            </Card>
          ))
        ) : (
          <Card>
            <Txt size="md">{t('featured.noPlans')}</Txt>
          </Card>
        )}
        {path === 'dev' && f.plans.length ? (
          <Txt size="xs" color={c.textMuted} align="center">
            {t('featured.devNote')}
          </Txt>
        ) : null}
        <Notice icon="clock">{t('featured.stackNote')}</Notice>
      </Section>

      <Section title={t('featured.history')}>
        <Card style={{ paddingVertical: space.xs }}>
          {f.history.length ? (
            f.history.map((h, i) => <HistoryRow key={h.id} h={h} first={i === 0} />)
          ) : (
            <View style={{ paddingVertical: space.md }}>
              <Txt size="md">{t('featured.noHistory')}</Txt>
            </View>
          )}
        </Card>
      </Section>
    </>
  );
}

function HistoryRow({ h, first }: { h: FeaturedPurchase; first: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const dates = h.startsAt && h.endsAt ? `${istDay(h.startsAt, lang)} – ${istDay(h.endsAt, lang)}` : istDay(h.createdAt, lang);
  return (
    <Row first={first} testID={`purchase-${h.id}`}>
      <View style={{ flex: 1, paddingVertical: space.sm, gap: 2 }}>
        <Txt variant="bold" size="md">
          {t('featured.days', { count: h.days })}
        </Txt>
        <Txt size="sm" color={c.textMuted}>
          {dates}
        </Txt>
      </View>
      {h.status === 'granted' ? (
        <Pill label={t('featured.granted')} tone="success" />
      ) : (
        <View style={{ alignItems: 'flex-end', gap: space.xs }}>
          <Txt variant="bold" size="md">
            {rupees(h.amountPaise)}
          </Txt>
          <Pill label={t('featured.paid')} tone="info" />
        </View>
      )}
    </Row>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: c.indigo, borderRadius: radius.lg, padding: space.xl, gap: space.md, flexDirection: 'row', alignItems: 'flex-start' },
  heroIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  status: { borderRadius: radius.lg, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md },
  planHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
});
