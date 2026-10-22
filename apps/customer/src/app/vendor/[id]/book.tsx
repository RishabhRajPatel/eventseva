// Booking details (BookingForm board): event, slot, quantity, note → send request. No payment now.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, SLOTS, todayIst, type Slot } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { ADVANCE_PERCENT, estimate, needsQuantity, parseQuantity } from '../../../lib/booking';
import { errorText } from '../../../lib/errors';
import { emptyEvent, validateEvent, type EventErrors } from '../../../lib/events';
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
import { OptionTile, TextField } from '../../../components/Form';
import { Icon } from '../../../components/Icon';
import { usePriceLabel } from '../../../components/ItemOption';
import { Screen, ScreenHeader } from '../../../components/Screen';
import { ErrorState, Loading } from '../../../components/States';
import { VendorImage } from '../../../components/VendorImage';

const NEW = 'new';

export default function BookingFormScreen() {
  const { id, item: itemParam, day } = useLocalSearchParams<{ id: string; item?: string; day?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const price = usePriceLabel();
  const today = todayIst();
  const vendor = useQuery({ queryKey: keys.vendor(id), queryFn: () => api.vendor(id) });
  const events = useQuery({ queryKey: keys.events, queryFn: api.events });
  const upcoming = useMemo(() => (events.data?.items ?? []).filter((e) => e.eventDate >= today), [events.data, today]);

  const [itemKeyState, setItemKey] = useState(itemParam ?? '');
  const [eventChoice, setEventChoice] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => emptyEvent(day ?? null));
  const [eventErrors, setEventErrors] = useState<EventErrors>({});
  const [slot, setSlot] = useState<Slot>('full');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Pick an event once the list arrives: the one on the chosen date, else the next one, else a new one.
  const chosenEvent = eventChoice ?? (events.data ? (upcoming.find((e) => e.eventDate === day) ?? upcoming[0])?.id ?? NEW : null);
  const event = upcoming.find((e) => e.id === chosenEvent);
  const eventDate = chosenEvent === NEW ? draft.eventDate : event?.eventDate ?? null;
  const months = eventDate ? [monthOf(eventDate)] : [monthOf(day ?? today)];
  const availability = useAvailability(id, months);
  const taken = availability.busy.filter((b) => b.day === eventDate).map((b) => b.slot);
  const free = freeSlots(taken);

  const items = vendor.data ? vendorItems(vendor.data) : [];
  const item = items.find((i) => itemKey(i) === itemKeyState) ?? items[0];
  const counted = item && item.unit !== 'package' && needsQuantity(item.unit);
  const qty = parseQuantity(quantity);
  const est = item ? estimate(item.pricePaise, item.unit === 'package' ? 'per_event' : item.unit, qty) : null;

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
      });
    },
    onSuccess: (booking) => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      void qc.invalidateQueries({ queryKey: ['vendor', id, 'availability'] });
      router.replace({ pathname: '/booking/[id]', params: { id: booking.id, sent: '1' } });
    },
    onError: (e) => setFormError(errorText(t, e)),
  });

  function submit() {
    setFormError(null);
    if (chosenEvent === NEW) {
      const { errors } = validateEvent(draft, today);
      setEventErrors(errors);
      if (Object.keys(errors).length) return setFormError(t('book.fixEvent'));
    }
    if (counted && !qty) return setFormError(t('book.quantityNeeded'));
    if (!free[slot]) return setFormError(t('book.slotTaken'));
    send.mutate();
  }

  if (vendor.isPending || events.isPending) return <Loading />;
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
      footer={
        <>
          {formError ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {formError}
            </AppText>
          ) : null}
          <AppText size="sm" align="center">
            {t('book.noPaymentNow')}
          </AppText>
          <Button label={t('book.send')} onPress={submit} loading={send.isPending} />
        </>
      }
    >
      <ScreenHeader title={t('book.title')} />

      <Card style={styles.vendorCard}>
        <VendorImage media={v.media.find((m) => m.type === 'photo') ?? null} slug={v.category.slug} width={48} height={48} style={styles.thumb} />
        <View style={styles.flex}>
          <AppText variant="bold" size={16}>
            {v.businessName}
          </AppText>
          <AppText size="sm">{[item.title, item.detail].filter(Boolean).join(' · ')}</AppText>
        </View>
      </Card>

      {items.length > 1 ? (
        <View style={styles.gap8}>
          <AppText variant="bold" size={14}>
            {t('book.what')}
          </AppText>
          {items.map((i) => {
            const on = itemKey(i) === itemKey(item);
            return (
              <Pressable
                key={itemKey(i)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${i.title}, ${price(i)}`}
                onPress={() => setItemKey(itemKey(i))}
                style={[styles.choice, on && styles.choiceOn]}
              >
                <AppText variant={on ? 'bold' : 'body'} size="md" style={styles.flex}>
                  {i.title}
                </AppText>
                <AppText variant="bold" size={14} color={c.royal}>
                  {price(i)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.gap8}>
        <AppText variant="bold" size={14}>
          {t('book.forEvent')}
        </AppText>
        {upcoming.map((e) => {
          const on = chosenEvent === e.id;
          return (
            <Pressable
              key={e.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setEventChoice(e.id)}
              style={[styles.choice, on && styles.choiceOn]}
            >
              <Icon name="calendar" size={18} color={on ? c.royal : c.ink} />
              <AppText variant={on ? 'bold' : 'body'} size="md" style={styles.flex}>
                {`${e.title} · ${formatDay(e.eventDate, lang)}`}
              </AppText>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: chosenEvent === NEW }}
          onPress={() => setEventChoice(NEW)}
          style={[styles.choice, chosenEvent === NEW && styles.choiceOn]}
        >
          <Icon name="plus" size={18} color={c.royal} />
          <AppText variant="bold" size="md" color={c.royal}>
            {t('book.newEvent')}
          </AppText>
        </Pressable>
      </View>

      {chosenEvent === NEW ? (
        <Card style={styles.newEvent}>
          <EventForm value={draft} onChange={setDraft} errors={eventErrors} busy={availability.byDay} />
        </Card>
      ) : null}

      <View style={styles.gap8}>
        <AppText variant="bold" size={14}>
          {t('book.time')}
        </AppText>
        <View style={styles.slots} accessibilityRole="radiogroup">
          {SLOTS.map((s) => (
            <OptionTile
              key={s}
              label={t(`slots.${s}.label`)}
              sublabel={free[s] ? t(`slots.${s}.hours`) : t('book.slotBooked')}
              selected={slot === s}
              disabled={!free[s]}
              onPress={() => setSlot(s)}
            />
          ))}
        </View>
        {eventDate && taken.length ? <AppText size="sm">{t('book.someTaken', { date: formatDay(eventDate, lang) })}</AppText> : null}
      </View>

      {counted && item.unit !== 'package' ? (
        <TextField
          label={t(`quantity.${item.unit}`)}
          placeholder={t('book.quantityPlaceholder')}
          value={quantity}
          onChangeText={(q) => setQuantity(q.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={6}
          error={quantity && !qty ? t('book.quantityBad') : null}
          hint={t('book.quantityHint', { price: price(item) })}
        />
      ) : null}

      <TextField
        label={t('book.note')}
        placeholder={t('book.notePlaceholder')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={500}
      />

      <Card style={styles.money}>
        <AppText variant="bold" size={14}>
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
  choice: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.lilac,
    backgroundColor: c.white,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  choiceOn: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  newEvent: { padding: space.lg },
  slots: { flexDirection: 'row', gap: space.sm },
  money: { padding: space.lg, gap: space.sm },
});
