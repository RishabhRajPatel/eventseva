// Renting items from a tent house / bartan vendor: event and dates, items and quantities (with
// what is free for those dates), a live price from the server, then the request. No payment now.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatClock, formatDay, rupees, todayIst, type PayMode, type Quote } from '@eventseva/app-shared';
import { api, type RentalRequest } from '../../../lib/api';
import { errorText } from '../../../lib/errors';
import { keys } from '../../../lib/queryClient';
import { addDaysTo, cartLines, istIso, lineProblem, maxQty, newIdempotencyKey, RENTAL_TIMES, rentalDays, stepQty, type Cart, type RentalItem } from '../../../lib/rental';
import { c, radius, space } from '../../../lib/theme';
import { useLanguage } from '../../../hooks/useLanguage';
import { AppText } from '../../../components/AppText';
import { Card, Divider, MoneyRow, Notice, Pill } from '../../../components/Bits';
import { PayModePicker } from '../../../components/PayModePicker';
import { Button } from '../../../components/Button';
import { Chip, ChoiceRow, TextField } from '../../../components/Form';
import { Icon } from '../../../components/Icon';
import { Screen, ScreenHeader } from '../../../components/Screen';
import { CardsSkeleton } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/States';
import { useToast } from '../../../components/Toast';
import { VendorImage } from '../../../components/VendorImage';

/** How far the delivery can move from the event day (the API allows a week either way). */
const DAY_OFFSETS = [-2, -1, 0, 1];
const MAX_EXTRA_DAYS = 14;
const UNITS = ['piece', 'set', 'pair', 'dozen'] as const;

export default function RentScreen() {
  const { id } = useLocalSearchParams<{ id: string; day?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIst();
  const events = useQuery({ queryKey: keys.events, queryFn: api.events });
  const upcoming = useMemo(() => (events.data?.items ?? []).filter((e) => e.eventDate >= today), [events.data, today]);

  const [eventId, setEventId] = useState<string | null>(null);
  const event = upcoming.find((e) => e.id === eventId) ?? upcoming[0];
  const [offset, setOffset] = useState(0);
  const [startTime, setStartTime] = useState<string>('10:00');
  const [extraDays, setExtraDays] = useState(1);
  const [endTime, setEndTime] = useState<string>('10:00');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [note, setNote] = useState('');
  const [payModeChoice, setPayMode] = useState<PayMode>('online');
  const [formError, setFormError] = useState<string | null>(null);

  const startDay = event ? addDaysTo(event.eventDate, offset) : null;
  const startsAt = startDay ? istIso(startDay, startTime) : null;
  const endsAt = startDay ? istIso(addDaysTo(startDay, extraDays), endTime) : null;
  const timesOk = !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const days = timesOk ? rentalDays(startsAt!, endsAt!) : 1;

  const catalogue = useQuery({
    queryKey: ['rentals', id, startsAt, endsAt, q.trim(), categoryId],
    queryFn: () => api.rentals(id, { ...(timesOk ? { from: startsAt!, until: endsAt! } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(categoryId ? { categoryId } : {}) }),
    placeholderData: (prev) => prev,
  });
  // Items seen so far, so the cart keeps its names and limits while the list is filtered.
  const known = useRef(new Map<string, RentalItem>());
  for (const i of catalogue.data?.items ?? []) known.current.set(i.id, i);
  // Cash only where the vendor accepts it for rentals.
  const cashOk = !!catalogue.data?.settings.cashAllowed;
  const payMode: PayMode = cashOk ? payModeChoice : 'online';
  const lines = cartLines(cart);
  const problems = lines.map((l) => ({ l, item: known.current.get(l.itemId), p: known.current.get(l.itemId) ? lineProblem(known.current.get(l.itemId)!, l.qty, days) : null }));
  const firstProblem = problems.find((x) => x.p);

  // The server prices the cart (rent × days, delivery, tax, deposit) a moment after the last change.
  const body: RentalRequest | null =
    event && catalogue.data?.serviceId && timesOk && lines.length ? { eventId: event.id, serviceId: catalogue.data.serviceId, startsAt: startsAt!, endsAt: endsAt!, lines } : null;
  const [debounced, setDebounced] = useState<RentalRequest | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(body), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(body)]);
  const quote = useQuery({
    queryKey: ['quote', JSON.stringify(debounced)],
    queryFn: () => api.quote(debounced!),
    enabled: !!debounced && !firstProblem,
    retry: false,
  });

  // A new key whenever the order changes; a retry of the same order reuses it.
  const keyRef = useRef({ body: '', key: newIdempotencyKey() });
  const send = useMutation({
    mutationFn: () => {
      const json = JSON.stringify(body);
      if (keyRef.current.body !== json) keyRef.current = { body: json, key: newIdempotencyKey() };
      return api.requestRental({ ...body!, note: note.trim() || undefined, ...(payMode === 'cash' ? { payMode } : {}) }, keyRef.current.key);
    },
    onSuccess: ({ id: bookingId }) => {
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('rent.sentToast'));
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId, sent: '1' } });
    },
    onError: (e) => setFormError(errorText(t, e)),
  });

  async function submit() {
    setFormError(null);
    if (!body) {
      setFormError(!lines.length ? t('rent.pickItems') : t('rent.pickTimes'));
      return false;
    }
    if (firstProblem) {
      setFormError(t(`rent.problem.${firstProblem.p!}`, { name: firstProblem.item?.name ?? '', min: firstProblem.item?.minQty ?? 1, max: firstProblem.item ? maxQty(firstProblem.item) : 0 }));
      return false;
    }
    await send.mutateAsync();
  }

  if (events.isPending || catalogue.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('rent.title')} />
        <CardsSkeleton count={3} height={110} />
      </Screen>
    );
  }
  if (events.error || catalogue.error) {
    return (
      <Screen>
        <ScreenHeader title={t('rent.title')} />
        <ErrorState error={events.error ?? catalogue.error} onRetry={() => (events.refetch(), catalogue.refetch())} />
      </Screen>
    );
  }
  if (!event) {
    return (
      <Screen>
        <ScreenHeader title={t('rent.title')} />
        <EmptyState icon="calendar" title={t('rent.needEvent')} body={t('rent.needEventBody')}
          actions={<Button label={t('rent.createEvent')} onPress={() => router.push('/event/new')} />} />
      </Screen>
    );
  }

  const cat = catalogue.data;
  const items = cat.items;
  return (
    <Screen
      scroll
      keyboard
      footer={
        <>
          {formError ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {formError}
            </AppText>
          ) : (
            <AppText size="sm" align="center">
              {quote.data ? t('rent.footerTotal', { total: rupees(quote.data.totalPaise), count: lines.length }) : t('book.noPaymentNow')}
            </AppText>
          )}
          <Button testID="send-rental" label={t('rent.send')} loadingLabel={t('book.sending')} onPress={submit} />
        </>
      }
    >
      <ScreenHeader title={t('rent.title')} />

      <View style={styles.gap8} accessibilityRole="radiogroup" accessibilityLabel={t('book.forEvent')}>
        <AppText variant="bold" size="sm">{t('book.forEvent')}</AppText>
        {upcoming.map((e) => (
          <ChoiceRow key={e.id} icon="calendar" label={`${e.title} · ${formatDay(e.eventDate, lang)}`} selected={event.id === e.id} onPress={() => setEventId(e.id)} />
        ))}
      </View>
      {!event.venueAddress ? (
        <Notice icon="pin" tone="peach">
          <AppText size="sm">{t('rent.addVenue')}</AppText>
          <Button label={t('rent.addVenueButton')} variant="outline" size="md" onPress={() => router.push({ pathname: '/event/[id]/venue', params: { id: event.id } })} />
        </Notice>
      ) : (
        <AppText size="sm">{t('rent.deliverTo', { address: event.venueAddress })}</AppText>
      )}

      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">{t('rent.deliveryDay')}</AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          {DAY_OFFSETS.map((o) => {
            const d = addDaysTo(event.eventDate, o);
            return <Chip key={o} label={formatDay(d, lang).replace(/ \d{4}$/, '')} selected={offset === o} disabled={d < today} onPress={() => setOffset(o)} />;
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('rent.deliveryTime')}>
          {RENTAL_TIMES.map((time) => (
            <Chip key={time} label={formatClock(time)} selected={startTime === time} onPress={() => setStartTime(time)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">{t('rent.returnAfter')}</AppText>
        <View style={styles.stepper}>
          <Stepper label={t('rent.days', { count: extraDays })} value={extraDays} min={0} max={MAX_EXTRA_DAYS} onChange={setExtraDays} testID="days" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('rent.pickupTime')}>
          {RENTAL_TIMES.map((time) => (
            <Chip key={time} label={formatClock(time)} selected={endTime === time} onPress={() => setEndTime(time)} />
          ))}
        </ScrollView>
        <AppText size="sm" color={timesOk ? c.text : c.danger}>
          {timesOk ? t('rent.summaryDays', { count: days, from: formatDay(startDay!, lang), until: formatDay(addDaysTo(startDay!, extraDays), lang) }) : t('rent.pickTimes')}
        </AppText>
      </View>

      <TextField testID="rent-search" label={t('rent.search')} placeholder={t('rent.searchPlaceholder')} value={q} onChangeText={setQ} maxLength={60} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('rent.categories')}>
        <Chip label={t('rent.all')} selected={!categoryId} onPress={() => setCategoryId(null)} />
        {cat.categories.map((k) => (
          <Chip key={k.id} label={`${lang === 'hi' ? k.nameHi : k.nameEn} · ${k.itemCount}`} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
        ))}
      </ScrollView>

      {items.length ? (
        items.map((item) => <ItemRow key={item.id} item={item} qty={cart[item.id] ?? 0} days={days} onChange={(n) => setCart({ ...cart, [item.id]: n })} />)
      ) : (
        <EmptyState compact icon="searchEmpty" title={t('rent.noItems')} />
      )}

      <TextField label={t('book.note')} placeholder={t('rent.notePlaceholder')} value={note} onChangeText={setNote} multiline maxLength={500} />
      {cashOk ? <PayModePicker value={payMode} onChange={setPayMode} /> : null}
      <QuoteCard quote={quote.data} error={quote.error} loading={quote.isFetching} empty={!lines.length} />
      {cat.settings.instructions ? <Notice icon="alert">{cat.settings.instructions}</Notice> : null}
    </Screen>
  );
}

function ItemRow({ item, qty, days, onChange }: { item: RentalItem; qty: number; days: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const max = maxQty(item);
  const problem = lineProblem(item, qty, days);
  const unit = UNITS.includes(item.unit as (typeof UNITS)[number]) ? t(`rent.units.${item.unit as (typeof UNITS)[number]}`) : item.unit;
  const price = item.rentPer === 'day' ? t('rent.pricePerDay', { price: rupees(item.rentPaise), unit }) : t('rent.pricePer', { price: rupees(item.rentPaise), unit });
  return (
    <Card style={styles.item}>
      <VendorImage media={item.photos[0] ?? null} icon="tent" width={64} height={64} style={styles.thumb} />
      <View style={styles.flex}>
        <AppText variant="bold" size="md" numberOfLines={2}>{item.name}</AppText>
        <AppText size="sm">{price}</AppText>
        <View style={styles.pills}>
          <Pill label={item.quality === 'custom' && item.qualityLabel ? item.qualityLabel : t(`rent.quality.${item.quality}`)} />
          {item.depositPaise ? <Pill label={t('rent.depositEach', { amount: rupees(item.depositPaise) })} tone="peach" /> : null}
        </View>
        <AppText size="xs" color={max ? c.textMuted : c.danger} testID={`free-${item.id}`}>
          {item.available === null ? t('rent.inStock', { count: item.stock }) : max ? t('rent.freeForDates', { count: item.available }) : t('rent.noneFree')}
        </AppText>
        {item.description ? <AppText size="xs" numberOfLines={2}>{item.description}</AppText> : null}
        {problem ? <AppText size="xs" color={c.danger}>{t(`rent.problem.${problem}`, { name: item.name, min: item.minQty, max: item.maxQty ?? max })}</AppText> : null}
      </View>
      <Stepper label={item.name} value={qty} min={0} max={max} onChange={onChange} step={(d) => stepQty(item, qty, d)} testID={`qty-${item.id}`} compact />
    </Card>
  );
}

/** − n + with a typed-in value; `step` lets items jump to their minimum. */
function Stepper({ label, value, min, max, onChange, step, testID, compact }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void; step?: (delta: number) => number; testID?: string; compact?: boolean;
}) {
  const { t } = useTranslation();
  const next = (d: number) => (step ? step(d) : Math.max(min, Math.min(max, value + d)));
  return (
    <View style={[styles.stepperRow, compact && styles.stepperCompact]}>
      <Pressable testID={`${testID}-minus`} accessibilityRole="button" accessibilityLabel={t('rent.less', { name: label })} disabled={value <= min}
        onPress={() => onChange(next(-1))} style={[styles.stepBtn, value <= min && styles.dim]}>
        <AppText variant="bold" size="lg" color={c.royal}>−</AppText>
      </Pressable>
      {compact ? (
        <TextInput testID={`${testID}-input`} value={value ? String(value) : ''} placeholder="0" placeholderTextColor={c.textMuted} keyboardType="number-pad" maxLength={6}
          onChangeText={(v) => onChange(Math.min(max, Number(v.replace(/\D/g, '') || 0)))} accessibilityLabel={t('rent.qtyFor', { name: label })} style={styles.qtyInput} />
      ) : (
        <AppText variant="bold" size="md" style={styles.stepValue}>{label}</AppText>
      )}
      <Pressable testID={`${testID}-plus`} accessibilityRole="button" accessibilityLabel={t('rent.more', { name: label })} disabled={value >= max}
        onPress={() => onChange(next(1))} style={[styles.stepBtn, value >= max && styles.dim]}>
        <Icon name="plus" size={18} color={c.royal} />
      </Pressable>
    </View>
  );
}

function QuoteCard({ quote, error, loading, empty }: { quote: Quote | undefined; error: unknown; loading: boolean; empty: boolean }) {
  const { t } = useTranslation();
  if (empty) return <Notice icon="alert">{t('rent.pickItems')}</Notice>;
  return (
    <Card style={styles.money}>
      <AppText variant="bold" size="sm">{t('rent.priceTitle')}{loading ? ' …' : ''}</AppText>
      {error ? <AppText size="sm" color={c.danger}>{errorText(t, error)}</AppText> : null}
      {quote ? (
        <>
          {quote.lines.filter((l) => l.kind !== 'deposit' && l.kind !== 'tax').map((l) => (
            <MoneyRow key={l.code} label={l.label} value={rupees(l.amountPaise)} small />
          ))}
          {quote.taxPaise ? <MoneyRow label={t('rent.tax')} value={rupees(quote.taxPaise)} small /> : null}
          <Divider />
          <MoneyRow label={t('rent.total')} value={rupees(quote.totalPaise)} strong />
          <MoneyRow label={t('rent.advance')} value={rupees(quote.advancePaise)} accent />
          <MoneyRow label={t('book.balance')} value={rupees(quote.balancePaise)} />
          {quote.depositPaise ? <MoneyRow label={t('rent.depositTotal')} value={rupees(quote.depositPaise)} /> : null}
          <AppText size="xs" color={c.textMuted}>{quote.approval === 'auto' ? t('rent.autoNote') : t('rent.approvalNote')}</AppText>
          {quote.notes.map((n) => <AppText key={n} size="xs" color={c.textMuted}>{n}</AppText>)}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  gap8: { gap: space.sm },
  chips: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md },
  thumb: { borderRadius: radius.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginVertical: 2 },
  stepper: { flexDirection: 'row' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepperCompact: { flexDirection: 'column-reverse', gap: space.xs },
  stepBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
  stepValue: { minWidth: 90, textAlign: 'center' },
  qtyInput: { width: 64, height: 44, textAlign: 'center', borderWidth: 1, borderColor: c.lavender, borderRadius: radius.md, backgroundColor: c.white, color: c.text, fontSize: 16 },
  money: { padding: space.lg, gap: space.sm },
});
