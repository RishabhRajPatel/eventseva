// Booking details (BookingForm board): event, slot, quantity, note → send request. No payment now.
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatClock, formatDay, formatDistance, formatMinutes, rupees, SLOTS, todayIst, type Slot } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { ADVANCE_PERCENT, estimate, needsQuantity, parseQuantity } from '../../../lib/booking';
import { errorText } from '../../../lib/errors';
import { emptyEvent, firstEventError, revalidate, validateEvent, validateField, type EventErrors } from '../../../lib/events';
import { vendorQuery } from '../../../lib/queries';
import { keys } from '../../../lib/queryClient';
import { c, radius, space } from '../../../lib/theme';
import { freeSlots, itemKey, vendorItems } from '../../../lib/vendor';
import { useAvailability } from '../../../hooks/useAvailability';
import { useLanguage } from '../../../hooks/useLanguage';
import { AppText } from '../../../components/AppText';
import { Card, Divider, MoneyRow, Notice } from '../../../components/Bits';
import { Button } from '../../../components/Button';
import { monthOf } from '../../../components/DatePicker';
import { EventForm } from '../../../components/EventForm';
import { Chip, ChoiceRow, FieldError, OptionTile, TextField } from '../../../components/Form';
import { usePriceLabel } from '../../../components/ItemOption';
import { Screen, ScreenHeader } from '../../../components/Screen';
import { CardsSkeleton } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/States';
import { useToast } from '../../../components/Toast';
import { VendorImage } from '../../../components/VendorImage';

const NEW = 'new';

/** Arrival times to offer (every 30 min), around the chosen slot. */
export function arrivalTimes(slot: Slot): string[] {
  const [from, to] = slot === 'day' ? [7, 15] : slot === 'night' ? [13, 21] : [6, 20];
  const out: string[] = [];
  for (let h = from; h <= to; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${m ? '30' : '00'}`);
  return out;
}
type Section = 'event' | 'slot' | 'quantity';

export default function BookingFormScreen() {
  const { id, item: itemParam, day } = useLocalSearchParams<{ id: string; item?: string; day?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const price = usePriceLabel();
  const today = todayIst();
  const vendor = useQuery(vendorQuery(id));
  const events = useQuery({ queryKey: keys.events, queryFn: api.events });
  const upcoming = useMemo(() => (events.data?.items ?? []).filter((e) => e.eventDate >= today), [events.data, today]);

  const [itemKeyState, setItemKey] = useState(itemParam ?? '');
  const [eventChoice, setEventChoice] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => emptyEvent(day ?? null));
  const [eventErrors, setEventErrors] = useState<EventErrors>({});
  const [slot, setSlot] = useState<Slot>('full');
  const [quantity, setQuantity] = useState('');
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [note, setNote] = useState('');
  const [arriveBy, setArriveBy] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Scroll to and focus the first wrong field on a failed submit (UX.md §3).
  const scroll = useRef<ScrollViewInstance>(null);
  const sectionY = useRef<Partial<Record<Section, number>>>({});
  const titleRef = useRef<TextInputInstance>(null);
  const guestsRef = useRef<TextInputInstance>(null);
  const venueRef = useRef<TextInputInstance>(null);
  const quantityRef = useRef<TextInputInstance>(null);
  const onSectionLayout = (s: Section) => (e: LayoutChangeEvent) => {
    sectionY.current[s] = e.nativeEvent.layout.y;
  };

  // Pick an event once the list arrives: the one on the chosen date, else the next one, else a new one.
  const chosenEvent = eventChoice ?? (events.data ? (upcoming.find((e) => e.eventDate === day) ?? upcoming[0])?.id ?? NEW : null);
  const event = upcoming.find((e) => e.id === chosenEvent);
  const eventDate = chosenEvent === NEW ? draft.eventDate : event?.eventDate ?? null;
  const months = eventDate ? [monthOf(eventDate)] : [monthOf(day ?? today)];
  const availability = useAvailability(id, months);
  const taken = availability.busy.filter((b) => b.day === eventDate).map((b) => b.slot);
  const free = freeSlots(taken);

  // How far this vendor travels to the chosen venue, before sending the request.
  const pin = chosenEvent === NEW ? draft.pin : (event?.venueLocation ?? null);
  const trip = useQuery({
    queryKey: ['vendor', id, 'travel', pin?.lat, pin?.lng],
    queryFn: () => api.vendorTravel(id, pin!),
    enabled: !!pin,
    staleTime: 10 * 60_000,
  });
  const travel = pin ? (trip.data?.travel ?? null) : null;

  const items = useMemo(() => (vendor.data ? vendorItems(vendor.data) : []), [vendor.data]);
  const item = items.find((i) => itemKey(i) === itemKeyState) ?? items[0];
  const counted = !!item && item.unit !== 'package' && needsQuantity(item.unit);
  const qty = parseQuantity(quantity);
  const est = item ? estimate(item.pricePaise, item.unit === 'package' ? 'per_event' : item.unit, qty) : null;

  const quantityError = counted && (quantityTouched || submitted) ? (!quantity ? t('book.quantityNeeded') : !qty ? t('book.quantityBad') : null) : null;
  const slotError = submitted && !free[slot] ? t('book.slotTaken') : null;

  const send = useMutation({
    mutationFn: async () => {
      let eventId = chosenEvent;
      if (eventId === NEW) {
        const created = await api.createEvent(validateEvent(draft).event!);
        // If the booking fails below, keep using this event instead of creating it again.
        setEventChoice(created.id);
        void qc.invalidateQueries({ queryKey: keys.events });
        eventId = created.id;
      }
      return api.createBooking({
        eventId: eventId!,
        vendorId: id,
        ...(item!.type === 'service' ? { serviceId: item!.id } : { packageId: item!.id }),
        slot,
        quantity: counted ? qty! : undefined,
        note: note.trim() || undefined,
        arriveBy: arriveBy ?? undefined,
      });
    },
    onSuccess: (booking) => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: ['vendor', id, 'availability'] });
      toast.success(t('book.sentToast', { name: vendor.data?.businessName ?? '' }));
      router.replace({ pathname: '/booking/[id]', params: { id: booking.id, sent: '1' } });
    },
    onError: (e) => setFormError(errorText(t, e)),
  });

  function goTo(section: Section, input?: TextInputInstance | null) {
    const y = sectionY.current[section];
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: true });
    // Focus after the scroll starts, so the keyboard does not fight the animation.
    if (input) setTimeout(() => input.focus(), 250);
  }

  /** Resolves false when the form has errors (the button then gives the error haptic). */
  async function submit() {
    setFormError(null);
    setSubmitted(true);
    const errors = chosenEvent === NEW ? validateEvent(draft, today).errors : {};
    setEventErrors(errors);
    const firstEvent = firstEventError(errors);
    if (firstEvent) {
      const input = firstEvent === 'title' ? titleRef.current : firstEvent === 'guests' ? guestsRef.current : firstEvent === 'venue' ? venueRef.current : null;
      goTo('event', input);
      return false;
    }
    if (!free[slot]) {
      goTo('slot');
      return false;
    }
    if (counted && !qty) {
      goTo('quantity', quantityRef.current);
      return false;
    }
    await send.mutateAsync();
  }

  if (vendor.isPending || events.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('book.title')} />
        <CardsSkeleton count={3} height={120} />
      </Screen>
    );
  }
  if (vendor.error || events.error) {
    return (
      <Screen>
        <ScreenHeader title={t('book.title')} />
        <ErrorState error={vendor.error ?? events.error} onRetry={() => (vendor.refetch(), events.refetch())} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <ScreenHeader title={t('book.title')} />
        <Notice icon="alert">{t('vendor.noItems')}</Notice>
      </Screen>
    );
  }

  const v = vendor.data;
  return (
    <Screen
      scroll
      keyboard
      scrollRef={scroll}
      footer={
        <>
          {formError ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {formError}
            </AppText>
          ) : (
            <AppText size="sm" align="center">
              {t('book.noPaymentNow')}
            </AppText>
          )}
          <Button label={t('book.send')} loadingLabel={t('book.sending')} onPress={submit} />
        </>
      }
    >
      <ScreenHeader title={t('book.title')} />

      <Card style={styles.vendorCard}>
        <VendorImage media={v.media.find((m) => m.type === 'photo') ?? null} icon={v.category.icon} width={48} height={48} style={styles.thumb} />
        <View style={styles.flex}>
          <AppText variant="bold" size="md">
            {v.businessName}
          </AppText>
          <AppText size="sm">{[item.title, item.detail].filter(Boolean).join(' · ')}</AppText>
        </View>
      </Card>

      {items.length > 1 ? (
        <View style={styles.gap8} accessibilityRole="radiogroup" accessibilityLabel={t('book.what')}>
          <AppText variant="bold" size="sm">
            {t('book.what')}
          </AppText>
          {items.map((i) => (
            <ChoiceRow key={itemKey(i)} label={i.title} right={price(i)} selected={itemKey(i) === itemKey(item)} onPress={() => setItemKey(itemKey(i))} />
          ))}
        </View>
      ) : null}

      <View style={styles.gap8} onLayout={onSectionLayout('event')} accessibilityRole="radiogroup" accessibilityLabel={t('book.forEvent')}>
        <AppText variant="bold" size="sm">
          {t('book.forEvent')}
        </AppText>
        {upcoming.map((e) => (
          <ChoiceRow key={e.id} icon="calendar" label={`${e.title} · ${formatDay(e.eventDate, lang)}`} selected={chosenEvent === e.id} onPress={() => setEventChoice(e.id)} />
        ))}
        <ChoiceRow icon="plus" label={t('book.newEvent')} selected={chosenEvent === NEW} onPress={() => setEventChoice(NEW)} />
        {chosenEvent === NEW ? (
          <Card style={styles.newEvent}>
            <EventForm
              value={draft}
              onChange={(d) => {
                setDraft(d);
                setEventErrors((current) => revalidate(d, current, today));
              }}
              onBlurField={(field) => setEventErrors((current) => validateField(draft, field, current, today))}
              errors={eventErrors}
              busy={availability.byDay}
              refs={{ title: titleRef, guests: guestsRef, venue: venueRef }}
            />
          </Card>
        ) : null}
      </View>

      <View style={styles.gap8} onLayout={onSectionLayout('slot')}>
        <AppText variant="bold" size="sm">
          {t('book.time')}
        </AppText>
        <View style={styles.slots} accessibilityRole="radiogroup" accessibilityLabel={t('book.time')}>
          {SLOTS.map((s) => (
            <OptionTile
              key={s}
              label={t(`slots.${s}.label`)}
              sublabel={free[s] ? t(`slots.${s}.hours`) : t('book.slotBooked')}
              selected={slot === s}
              disabled={!free[s]}
              onPress={() => {
                setSlot(s);
                if (arriveBy && !arrivalTimes(s).includes(arriveBy)) setArriveBy(null);
              }}
            />
          ))}
        </View>
        <FieldError>{slotError}</FieldError>
        {eventDate && taken.length && !slotError ? <AppText size="sm">{t('book.someTaken', { date: formatDay(eventDate, lang) })}</AppText> : null}
      </View>

      {counted && item.unit !== 'package' ? (
        <View onLayout={onSectionLayout('quantity')}>
          <TextField
            ref={quantityRef}
            label={t(`quantity.${item.unit}`)}
            placeholder={t('book.quantityPlaceholder')}
            value={quantity}
            onChangeText={(q) => setQuantity(q.replace(/\D/g, ''))}
            onBlur={() => setQuantityTouched(true)}
            keyboardType="number-pad"
            maxLength={6}
            error={quantityError}
            hint={t('book.quantityHint', { price: price(item) })}
          />
        </View>
      ) : null}

      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">
          {t('arrive.label')}
        </AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('arrive.title')}>
          <Chip label={t('arrive.none')} selected={!arriveBy} onPress={() => setArriveBy(null)} />
          {arrivalTimes(slot).map((time) => (
            <Chip key={time} label={formatClock(time)} selected={arriveBy === time} onPress={() => setArriveBy(time)} />
          ))}
        </ScrollView>
        <AppText size="xs" color={c.textMuted}>
          {t('arrive.hint')}
        </AppText>
      </View>

      {travel ? (
        <Notice icon="pin" tone={travel.outsideServiceArea ? 'peach' : 'lavender'}>
          <AppText size="md">
            {t('trip.distance', { km: formatDistance(travel.roadKm, lang) })} · {t('trip.time', { time: formatMinutes(travel.minutes, lang) })}
          </AppText>
          {travel.outsideServiceArea && travel.serviceRadiusKm ? (
            <AppText size="sm" color={c.warningText}>
              {t('trip.outside', { radius: formatDistance(travel.serviceRadiusKm, lang) })}
            </AppText>
          ) : null}
        </Notice>
      ) : null}

      <TextField label={t('book.note')} placeholder={t('book.notePlaceholder')} value={note} onChangeText={setNote} multiline maxLength={500} />

      <Card style={styles.money}>
        <AppText variant="bold" size="sm">
          {t('book.estimateTitle')}
        </AppText>
        {est ? (
          <>
            <MoneyRow label={counted && qty ? t('book.priceTimes', { price: rupees(item.pricePaise), qty }) : t('book.price')} value={rupees(est.amountPaise)} />
            <MoneyRow label={t('book.advance', { percent: ADVANCE_PERCENT })} value={rupees(est.advancePaise)} accent />
            <MoneyRow label={t('book.balance')} value={rupees(est.balancePaise)} />
          </>
        ) : (
          <AppText size="sm">{t('book.estimateNeedsQty')}</AppText>
        )}
        <Divider />
        <AppText size="xs" color={c.textMuted}>
          {t('book.estimateNote')}
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap8: { gap: space.sm },
  vendorCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { borderRadius: radius.md },
  newEvent: { padding: space.lg },
  slots: { flexDirection: 'row', gap: space.sm },
  chips: { gap: space.sm },
  money: { padding: space.lg, gap: space.sm },
});
