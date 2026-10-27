import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type FeaturedOverview, type FeaturedPlan, type FeaturedPurchase } from '@eventseva/app-shared';
import { buyFeatured, choosePaymentPath, PaymentError } from '../lib/payments';
import { errorCode, errorText } from '../lib/errors';
import { istDay, perDayPaise } from '../lib/labels';
import { keys, useFeatured, useVendor } from '../lib/queries';
import { haptic } from '../lib/haptics';
import { toast } from '../lib/toast';
import { c, DISABLED_OPACITY, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button } from '../components/Button';
import { Card, Row, Section } from '../components/Card';
import { Pill, selectStyles, Tick } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { EmptyInline, QueryView } from '../components/States';
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

type BuyState = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

function FeaturedBody({ f }: { f: FeaturedOverview }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const vendor = useVendor();
  const [path] = useState(choosePaymentPath);
  // The best value (the longest plan) is picked to start with.
  const [planId, setPlanId] = useState<number | null>(() => (f.plans.length ? [...f.plans].sort((a, b) => b.days - a.days)[0].id : null));
  const [state, setState] = useState<BuyState>({ kind: 'idle' });
  const plan = f.plans.find((p) => p.id === planId) ?? null;

  const buy = useMutation({
    mutationFn: (p: FeaturedPlan) => buyFeatured(p, { name: vendor.data?.businessName }, path),
    onMutate: () => setState({ kind: 'idle' }),
    onSuccess: (res) => {
      // Closing the checkout is not an error: say nothing was charged and stay.
      if (res.status === 'cancelled') {
        setState({ kind: 'cancelled' });
        toast.info(t('featured.cancelled'));
        return;
      }
      qc.setQueryData(keys.featured, res.overview);
      void qc.invalidateQueries({ queryKey: keys.featured });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.vendor });
      const message = res.overview.featuredUntil ? t('featured.success', { day: istDay(res.overview.featuredUntil, lang) }) : t('featured.successNoDate');
      setState({ kind: 'success', message });
      toast.success(message);
    },
    onError: (e) => {
      const code = errorCode(e);
      // A plan was switched off or the profile went off-line meanwhile: show the current state.
      if (code === 'PLAN_NOT_FOUND' || code === 'VENDOR_NOT_ACTIVE') void qc.invalidateQueries({ queryKey: keys.featured });
      const message = e instanceof PaymentError ? t('featured.paymentFailed') : code === 'VENDOR_NOT_ACTIVE' ? t('featured.notLive') : errorText(t, e);
      setState({ kind: 'failed', message });
      toast.error(message);
    },
  });

  const pick = (id: number) => {
    if (buy.isPending) return;
    if (id !== planId) haptic.select();
    setPlanId(id);
    if (state.kind !== 'success') setState({ kind: 'idle' });
  };

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
          <Icon name="check" size={20} color={c.onSuccess} />
          <View style={{ flex: 1 }}>
            <Txt variant="bold" size="md" color={c.onSuccess}>
              {t('featured.until', { day: istDay(f.featuredUntil, lang) })}
            </Txt>
            <Txt size="sm" color={c.onSuccess}>
              {t('featured.activeNote')}
            </Txt>
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

      {state.kind === 'success' ? (
        <Notice icon="check" tone="success" testID="featured-success">
          {state.message}
        </Notice>
      ) : state.kind === 'failed' ? (
        <Notice icon="alert" tone="danger" testID="featured-failed">
          {state.message}
        </Notice>
      ) : state.kind === 'cancelled' ? (
        <Notice icon="clock" testID="featured-cancelled">
          {t('featured.cancelled')}
        </Notice>
      ) : null}
      {!f.canBuy ? (
        <Notice icon="lock" tone="warning" testID="featured-locked">
          {t('featured.notLive')}
        </Notice>
      ) : null}

      <Section title={t('featured.plans')}>
        {f.plans.length ? (
          <View style={{ gap: space.md }} accessibilityRole="radiogroup" accessibilityLabel={t('featured.plans')}>
            {f.plans.map((p) => (
              <PlanCard key={p.id} plan={p} selected={p.id === planId} disabled={!f.canBuy || buy.isPending} onPick={pick} />
            ))}
          </View>
        ) : (
          <Card>
            <EmptyInline icon="star" text={t('featured.noPlans')} />
          </Card>
        )}
        {plan ? (
          <Button
            testID="buy"
            kind="indigo"
            size="lg"
            icon="star"
            label={path === 'dev' ? t('featured.devButtonPlan', { days: t('featured.days', { count: plan.days }) }) : t('featured.buyPlan', { days: t('featured.days', { count: plan.days }), amount: rupees(plan.pricePaise) })}
            loadingLabel={t('featured.paying')}
            loading={buy.isPending}
            disabled={!f.canBuy}
            onPress={() => {
              if (f.canBuy && !buy.isPending && plan) buy.mutate(plan);
            }}
          />
        ) : null}
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
            <EmptyInline icon="clock" text={t('featured.noHistory')} />
          )}
        </Card>
      </Section>
    </>
  );
}

/** One plan as a radio card: lilac fill, royal border and ✓ when chosen (UX.md §2). */
const PlanCard = memo(function PlanCard({ plan: p, selected, disabled, onPick }: { plan: FeaturedPlan; selected: boolean; disabled: boolean; onPick: (id: number) => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID={`plan-${p.id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={`${p.name}, ${t('featured.days', { count: p.days })}, ${rupees(p.pricePaise)}`}
      disabled={disabled}
      onPress={() => onPick(p.id)}
      style={({ pressed }) => [styles.plan, selected ? selectStyles.on : selectStyles.off, disabled && !selected ? { opacity: DISABLED_OPACITY } : pressed ? { opacity: 0.85 } : null]}
    >
      <View style={[styles.radio, selected ? null : styles.radioOff]}>{selected ? <Tick size={24} /> : null}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bold" size="lg">
          {p.name}
        </Txt>
        <Txt size="sm" color={selected ? c.ink : c.textMuted}>
          {t('featured.days', { count: p.days })}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Txt variant="bold" size="xl" color={c.royal}>
          {rupees(p.pricePaise)}
        </Txt>
        <Txt size="xs" color={selected ? c.ink : c.textMuted}>
          {t('featured.perDay', { amount: rupees(perDayPaise(p.pricePaise, p.days)) })}
        </Txt>
      </View>
    </Pressable>
  );
});

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
  plan: { borderRadius: radius.lg, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72 },
  radio: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  radioOff: { borderWidth: 2, borderColor: c.muted },
});
