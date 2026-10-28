// Booking a service priced by time or quantity (DJ night, catering for guests, a wedding car, cooks,
// makeup, a planner's quotation): event, day and time, how long or how many, the vendor's questions,
// extras, a live price from the server, then the request — or add it to the cart with other vendors.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatClock, formatDay, rupees, todayIst, type EngineBookingRequest, type PublicEngineService, type Quote } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { cart } from '../../../lib/cart';
import {
  answerErrors,
  asksDuration,
  carModes,
  countKind,
  DAY_OFFSETS,
  defaultHours,
  durationChoices,
  formProblem,
  newKey,
  offsetDay,
  perModel,
  START_TIMES,
  toRequest,
  type EngineForm,
} from '../../../lib/engine';
import { errorText } from '../../../lib/errors';
import { vendorQuery } from '../../../lib/queries';
import { keys } from '../../../lib/queryClient';
import { c, space } from '../../../lib/theme';
import { useLanguage } from '../../../hooks/useLanguage';
import { AppText } from '../../../components/AppText';
import { Card, Divider, MoneyRow, Notice, Pill } from '../../../components/Bits';
import { Button } from '../../../components/Button';
import { AnswerField, PlaceField } from '../../../components/EngineFields';
import { Chip, ChoiceRow, TextField } from '../../../components/Form';
import { Screen, ScreenHeader } from '../../../components/Screen';
import { CardsSkeleton } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/States';
import { useToast } from '../../../components/Toast';

export default function EngineBookScreen() {
  const { id, service: serviceParam, bundle: bundleParam } = useLocalSearchParams<{ id: string; service?: string; bundle?: string }>();
  const { t } = useTranslation();
  const today = todayIst();
  const vendor = useQuery(vendorQuery(id));
  const services = useQuery({ queryKey: ['engineServices', id], queryFn: () => api.engineServices(id) });
  const events = useQuery({ queryKey: keys.events, queryFn: api.events });
  const upcoming = useMemo(() => (events.data?.items ?? []).filter((e) => e.eventDate >= today), [events.data, today]);

  const title = t('engineBook.title');
  if (services.isPending || events.isPending || vendor.isPending) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <CardsSkeleton count={3} height={110} />
      </Screen>
    );
  }
  if (services.error || events.error || vendor.error) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <ErrorState error={services.error ?? events.error ?? vendor.error} onRetry={() => (services.refetch(), events.refetch(), vendor.refetch())} />
      </Screen>
    );
  }
  if (!upcoming.length) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <EmptyState icon="calendar" title={t('rent.needEvent')} body={t('engineBook.needEventBody')} actions={<Button label={t('rent.createEvent')} onPress={() => router.push('/event/new')} />} />
      </Screen>
    );
  }
  const list = services.data.items;
  if (!list.length) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <EmptyState icon="searchEmpty" title={t('engineBook.noServices')} />
      </Screen>
    );
  }
  return <BookForm vendorId={id} vendorName={vendor.data.businessName} services={list} events={upcoming} initialService={serviceParam} bundleId={bundleParam} />;
}

function BookForm({ vendorId, vendorName, services, events, initialService, bundleId }: {
  vendorId: string;
  vendorName: string;
  services: PublicEngineService[];
  events: { id: string; title: string; eventDate: string; venueAddress: string | null; venueLocation: { lat: number; lng: number } | null; guestCount: number | null }[];
  initialService?: string;
  bundleId?: string;
}) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIst();
  const [serviceId, setServiceId] = useState(services.find((s) => s.id === initialService)?.id ?? services[0].id);
  const s = services.find((x) => x.id === serviceId)!;
  const [eventId, setEventId] = useState(events[0].id);
  const event = events.find((e) => e.id === eventId)!;
  const venue = event.venueAddress && event.venueLocation ? { address: event.venueAddress, ...event.venueLocation } : null;
  const modes = carModes(s);
  const kind = countKind(s.bookingType);

  const [form, setForm] = useState<EngineForm>(() => ({
    eventId: event.id,
    eventDay: event.eventDate,
    dayOffset: 0,
    startTime: s.rules.workingHours?.from && START_TIMES.includes(s.rules.workingHours.from as never) ? s.rules.workingHours.from : '18:00',
    hours: defaultHours(s),
    count: kind === 'guests' && event.guestCount ? String(event.guestCount) : kind ? String(s.rules.minQty ?? 1) : '',
    mode: modes[0],
    pickup: null,
    destination: venue,
    answers: {},
    addons: {},
    note: '',
  }));
  const set = (patch: Partial<EngineForm>) => setForm((f) => ({ ...f, ...patch }));
  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Switching service or event resets what depends on it.
  useEffect(() => {
    set({ hours: defaultHours(s), mode: carModes(s)[0], answers: {}, addons: {}, count: kind === 'guests' && event.guestCount ? String(event.guestCount) : kind ? String(s.rules.minQty ?? 1) : '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);
  useEffect(() => {
    set({ eventId: event.id, eventDay: event.eventDate, dayOffset: 0, destination: venue ?? form.destination });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const problem = formProblem(s, form);
  const request = problem ? null : toRequest(s, form);
  const json = JSON.stringify(request);
  const [debounced, setDebounced] = useState<EngineBookingRequest | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(request), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);
  const quote = useQuery({ queryKey: ['engineQuote', JSON.stringify(debounced)], queryFn: () => api.engineQuote(debounced!), enabled: !!debounced, retry: false });

  const keyRef = useRef({ body: '', key: newKey() });
  const send = useMutation({
    mutationFn: () => {
      if (keyRef.current.body !== json) keyRef.current = { body: json, key: newKey() };
      return api.requestEngine(request!, keyRef.current.key);
    },
    onSuccess: ({ id: bookingId }) => {
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('engineBook.sentToast'));
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId, sent: '1' } });
    },
    onError: (e) => setFormError(errorText(t, e)),
  });

  const problemText = problem
    ? t(`engineBook.problem.${problem}`, { min: s.rules.minQty ?? s.minGuests ?? 1, max: s.rules.maxQty ?? s.maxGuests ?? '—', what: kind ? t(`engineBook.count.${kind}`) : '' })
    : null;

  async function submit() {
    setTried(true);
    setFormError(null);
    if (problem || !request) {
      setFormError(problemText);
      return false;
    }
    await send.mutateAsync();
  }

  function addToCart() {
    setTried(true);
    if (problem || !request) {
      setFormError(problemText);
      return false;
    }
    const result = cart.add({ vendorId, vendorName, serviceTitle: s.title, request });
    if (result === 'otherEvent') {
      setFormError(t('cart.otherEvent'));
      return false;
    }
    if (result === 'full') {
      setFormError(t('cart.full'));
      return false;
    }
    if (bundleId) {
      const b = cart.get().bundle;
      if (!b) void api.bundles(vendorId).then((r) => {
        const found = r.items.find((x) => x.id === bundleId);
        if (found) cart.setBundle({ id: found.id, vendorId, name: found.name, discountPercent: found.discountPercent });
      });
    }
    toast.success(t('cart.added', { name: s.title }));
    // Back to the cart if it is already open (adding a package's missing service).
    router.navigate('/cart');
  }

  const errors = tried ? answerErrors(s.questions, form.answers) : {};
  const quoteError = quote.error;
  const per = s.pricing.model === 'quote' ? t('engineBook.quotePrice') : `${rupees(s.pricing.ratePaise)} ${t(`engineBook.per.${perModel(s.pricing.model)}`)}`;

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
              {quote.data ? t('engineBook.footerTotal', { total: rupees(quote.data.totalPaise), advance: rupees(quote.data.advancePaise) }) : t('book.noPaymentNow')}
            </AppText>
          )}
          <View style={styles.footerRow}>
            <Button label={t('cart.add')} variant="outline" size="md" style={styles.flex} onPress={addToCart} />
            <Button testID="send-engine" label={s.rules.approval === 'auto' ? t('engineBook.bookNow') : t('engineBook.send')} loadingLabel={t('book.sending')} size="md" style={styles.flex} onPress={submit} />
          </View>
        </>
      }
    >
      <ScreenHeader title={t('engineBook.title')} />

      {services.length > 1 ? (
        <View style={styles.gap8} accessibilityRole="radiogroup" accessibilityLabel={t('engineBook.service')}>
          <AppText variant="bold" size="sm">{t('engineBook.service')}</AppText>
          {services.map((x) => (
            <ChoiceRow key={x.id} icon="star" label={x.title} right={x.pricing.model === 'quote' ? t('engineBook.quotePrice') : rupees(x.pricing.ratePaise)} selected={x.id === serviceId} onPress={() => setServiceId(x.id)} />
          ))}
        </View>
      ) : null}
      <Card style={styles.card}>
        <AppText variant="bold" size="lg">{s.title}</AppText>
        <AppText size="sm">{per}</AppText>
        {s.description ? <AppText size="sm" color={c.textMuted}>{s.description}</AppText> : null}
        {s.resource ? (
          <AppText size="sm">
            {[s.resource.name, s.resource.attributes.registrationMasked].filter(Boolean).join(' · ')}
          </AppText>
        ) : null}
        <View style={styles.pills}>
          {s.rules.approval === 'auto' ? <Pill label={t('engineBook.instant')} tone="mint" /> : null}
          {s.pricing.taxPercent ? <Pill label={t('engineBook.gst', { n: s.pricing.taxPercent })} /> : null}
        </View>
      </Card>

      <View style={styles.gap8} accessibilityRole="radiogroup" accessibilityLabel={t('book.forEvent')}>
        <AppText variant="bold" size="sm">{t('book.forEvent')}</AppText>
        {events.map((e) => (
          <ChoiceRow key={e.id} icon="calendar" label={`${e.title} · ${formatDay(e.eventDate, lang)}`} selected={e.id === eventId} onPress={() => setEventId(e.id)} />
        ))}
      </View>

      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">{t('engineBook.day')}</AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          {DAY_OFFSETS.map((o) => {
            const d = offsetDay(event.eventDate, o);
            return <Chip key={o} label={formatDay(d, lang).replace(/ \d{4}$/, '')} selected={form.dayOffset === o} disabled={d < today} onPress={() => set({ dayOffset: o })} />;
          })}
        </ScrollView>
        <AppText variant="bold" size="sm">{t('engineBook.startTime')}</AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('engineBook.startTime')}>
          {START_TIMES.map((time) => (
            <Chip key={time} label={formatClock(time)} selected={form.startTime === time} onPress={() => set({ startTime: time })} />
          ))}
        </ScrollView>
        {asksDuration(s.bookingType) ? (
          <>
            <AppText variant="bold" size="sm">{t('engineBook.howLong')}</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('engineBook.howLong')}>
              {durationChoices(s).map((h) => (
                <Chip key={h} label={h >= 24 && h % 24 === 0 ? t('engineBook.days', { count: h / 24 }) : t('engineBook.hours', { count: h })} selected={form.hours === h} onPress={() => set({ hours: h })} />
              ))}
            </ScrollView>
          </>
        ) : null}
      </View>

      {kind ? (
        <TextField
          label={t(`engineBook.count.${kind}`)}
          value={form.count}
          onChangeText={(v) => set({ count: v.replace(/\D/g, '') })}
          keyboardType="number-pad"
          maxLength={6}
          hint={s.rules.minQty || s.rules.maxQty ? t('engineBook.countRange', { min: s.rules.minQty ?? 1, max: s.rules.maxQty ?? '—' }) : undefined}
          error={tried && (problem === 'count' || problem === 'countRange') ? problemText : null}
        />
      ) : null}

      {s.bookingType === 'transport' ? (
        <View style={styles.gap8}>
          {modes.length > 1 ? (
            <View style={styles.chipsWrap} accessibilityRole="radiogroup" accessibilityLabel={t('engineBook.mode')}>
              {modes.map((m) => (
                <Chip key={m} label={t(`engineBook.modes.${m}`)} selected={form.mode === m} onPress={() => set({ mode: m })} />
              ))}
            </View>
          ) : (
            <AppText size="sm">{t(`engineBook.modes.${modes[0]}`)}</AppText>
          )}
          {form.mode === 'self_drive' ? (
            <Notice icon="alert" tone="peach">
              <AppText size="sm">{t('engineBook.selfDriveNote', { age: s.rules.minAge ?? 21 })}</AppText>
              <Button label={t('licence.open')} variant="outline" size="md" onPress={() => router.push('/licence')} />
            </Notice>
          ) : null}
          <PlaceField testID="pickup" label={t('engineBook.pickup')} value={form.pickup} onChange={(pickup) => set({ pickup })} />
          <PlaceField testID="destination" label={t('engineBook.destination')} value={form.destination} onChange={(destination) => set({ destination })} />
          {tried && problem === 'route' ? <AppText size="sm" color={c.danger}>{problemText}</AppText> : null}
        </View>
      ) : null}

      {s.questions.map((q) => (
        <AnswerField key={q.key} field={q} value={form.answers[q.key]} onChange={(v) => set({ answers: { ...form.answers, [q.key]: v } })} error={errors[q.key] ?? null} />
      ))}

      {s.addons.length ? (
        <View style={styles.gap8}>
          <AppText variant="bold" size="sm">{t('engineBook.extras')}</AppText>
          {s.addons.map((a) => {
            const cur = form.addons[a.id] ?? { on: false, note: '' };
            return (
              <View key={a.id} style={styles.gap4}>
                <ChoiceRow
                  icon="plus"
                  label={a.name}
                  right={`+${rupees(a.pricePaise)}`}
                  selected={cur.on}
                  onPress={() => set({ addons: { ...form.addons, [a.id]: { ...cur, on: !cur.on } } })}
                />
                {cur.on && a.requiresApproval ? <AppText size="xs" color={c.textMuted}>{t('engineBook.extraAsks')}</AppText> : null}
                {cur.on && a.inclusions.length ? <AppText size="xs" color={c.textMuted}>{t('engineBook.includes', { list: a.inclusions.join(', ') })}</AppText> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <TextField label={t('book.note')} placeholder={t('engineBook.notePlaceholder')} value={form.note} onChangeText={(note) => set({ note })} multiline maxLength={500} />
      <QuoteCard quote={quote.data} error={quoteError} loading={quote.isFetching} waiting={!!problem} />
      {s.rules.instructions ? <Notice icon="alert">{s.rules.instructions}</Notice> : null}
    </Screen>
  );
}

function QuoteCard({ quote, error, loading, waiting }: { quote: Quote | undefined; error: unknown; loading: boolean; waiting: boolean }) {
  const { t } = useTranslation();
  if (waiting && !quote) return <Notice icon="alert">{t('engineBook.fillToPrice')}</Notice>;
  return (
    <Card style={styles.card} >
      <AppText variant="bold" size="sm">{t('rent.priceTitle')}{loading ? ' …' : ''}</AppText>
      {error ? <AppText size="sm" color={c.danger}>{errorText(t, error)}</AppText> : null}
      {quote ? (
        <>
          {quote.lines.filter((l) => l.kind !== 'deposit' && l.kind !== 'tax').map((l) => (
            <MoneyRow key={l.code} label={l.label} value={rupees(l.amountPaise)} small />
          ))}
          {quote.taxPaise ? <MoneyRow label={t('rent.tax')} value={rupees(quote.taxPaise)} small /> : null}
          <Divider />
          {quote.priceKind === 'indicative' ? <AppText size="xs" color={c.textMuted}>{t('engineBook.indicative')}</AppText> : null}
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
  flex: { flex: 1 },
  gap4: { gap: space.xs },
  gap8: { gap: space.sm },
  chips: { gap: space.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  card: { padding: space.lg, gap: space.sm },
  footerRow: { flexDirection: 'row', gap: space.sm },
});
