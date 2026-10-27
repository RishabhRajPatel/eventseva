import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking, type TripInspection, type TripView } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { confirm } from '../lib/confirm';
import { errorText } from '../lib/errors';
import { bookable, checkReadings, engineKeys, nextTripStep, useResources, useTrip } from '../lib/engine';
import { rupeesInputToPaise } from '../lib/money';
import { invalidateBookings } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { useEvidencePhotos } from '../hooks/useEvidencePhotos';
import { useLang } from '../hooks/useLang';
import { Button, LinkButton } from './Button';
import { Card, CardHeader, Row } from './Card';
import { ChoiceChip, Pill } from './Chip';
import { Field } from './Field';
import { Notice } from './Notice';
import { QueryView } from './States';
import { Txt } from './Txt';

const FUEL = [0, 1, 2, 3, 4, 5, 6, 7, 8];
type Damage = { description: string; amount: string };

/** Optional rupees: empty is 0, a bad amount is null. */
const optionalPaise = (text: string) => (text.trim() ? rupeesInputToPaise(text) : 0);

/** Car bookings: driver, handover (odometer, fuel, photos) and return with the agreed extra charges. */
export function TripPanel({ booking }: { booking: Booking }) {
  const trip = useTrip(booking.id, booking.bookingType === 'transport');
  return <QueryView query={trip}>{(tv) => <Panel booking={booking} trip={tv} />}</QueryView>;
}

function Panel({ booking, trip }: { booking: Booking; trip: TripView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const step = nextTripStep(trip, booking.status === 'confirmed');
  const handover = trip.inspections.find((i) => i.phase === 'handover');

  const done = (v: TripView, message: string) => {
    qc.setQueryData(engineKeys.trip(booking.id), v);
    invalidateBookings(qc, booking.id);
    toast.success(message);
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: 'driver' | 'handover' | 'return'; body: object }) => api.post<TripView>(`/v1/partner/bookings/${booking.id}/trip/${path}`, body),
    onSuccess: (v, { path }) => done(v, t(`carTrip.done.${path}`)),
    onError: (e) => toast.error(errorText(t, e)),
  });

  return (
    <Card style={{ gap: space.md }} testID="trip-panel">
      <CardHeader title={t('carTrip.title')} right={<Pill label={t(`carTrip.fulfilment.${trip.fulfilment}`)} tone={trip.fulfilment === 'closed' ? 'success' : 'info'} />} />
      <Txt size="sm" color={c.textMuted}>
        {t('carTrip.window', { from: formatDateTime(trip.startsAt, lang), until: formatDateTime(trip.endsAt, lang) })} · {t(`carTrip.mode.${trip.mode}`)}
      </Txt>
      {trip.vehicle ? <Txt size="md">{[trip.vehicle.name, trip.vehicle.registration].filter(Boolean).join(' · ')}</Txt> : null}
      {trip.route ? (
        <View style={{ gap: 2 }}>
          <Txt size="sm">{t('carTrip.pickup', { place: trip.route.pickup.address })}</Txt>
          <Txt size="sm">{t('carTrip.drop', { place: trip.route.destination.address })}</Txt>
        </View>
      ) : null}
      {trip.driver ? <Txt size="sm">{t('carTrip.driver', { name: trip.driver.name })}</Txt> : null}

      {step === 'assign' || (step === 'handover' && trip.mode === 'with_driver') ? <AssignDriver trip={trip} busy={act.isPending} onAssign={(driverId) => act.mutate({ path: 'driver', body: { driverId } })} /> : null}
      {step === 'handover' ? <InspectionForm phase="handover" busy={act.isPending} onSave={(body) => act.mutate({ path: 'handover', body })} /> : null}
      {step === 'return' ? <InspectionForm phase="return" handoverKm={handover?.readings.odometerKm} busy={act.isPending} onSave={(body) => act.mutate({ path: 'return', body })} /> : null}

      {trip.inspections.map((i) => (
        <InspectionLine key={i.phase} inspection={i} />
      ))}
      {trip.charges.length ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="bold" size="sm">{t('rental.charges')}</Txt>
          {trip.charges.map((ch) => (
            <View key={ch.id} style={styles.line}>
              <Txt size="sm" style={{ flex: 1 }}>{ch.description}</Txt>
              <Txt size="sm" variant="bold">{rupees(ch.amountPaise)}</Txt>
              <Pill label={t(`rental.chargeStatus.${ch.status}`)} tone={ch.status === 'disputed' ? 'warning' : ch.status === 'proposed' ? 'neutral' : 'success'} />
            </View>
          ))}
        </View>
      ) : null}
      <Txt size="sm" color={c.textMuted} testID="trip-deposit">
        {trip.deposit.requiredPaise
          ? t('rental.depositLine', { paid: rupees(trip.deposit.paidPaise), required: rupees(trip.deposit.requiredPaise) }) +
            (trip.deposit.settledAt ? ` · ${t('rental.depositKept', { amount: rupees(trip.deposit.keptPaise) })}` : '')
          : t('rental.noDeposit')}
      </Txt>
    </Card>
  );
}

function AssignDriver({ trip, busy, onAssign }: { trip: TripView; busy: boolean; onAssign: (driverId: string) => void }) {
  const { t } = useTranslation();
  const resources = useResources();
  const drivers = (resources.data ?? []).filter((r) => r.kind === 'driver' && bookable(r));
  const [picked, setPicked] = useState<string | null>(trip.driver?.id ?? null);
  return (
    <View style={{ gap: space.sm }} testID="assign-driver">
      <Txt variant="bold" size="sm">{trip.driver ? t('carTrip.changeDriver') : t('carTrip.chooseDriver')}</Txt>
      {drivers.length ? (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('carTrip.chooseDriver')}>
          {drivers.map((d) => (
            <ChoiceChip key={d.id} testID={`driver-${d.id}`} label={d.name} selected={picked === d.id} onPress={() => setPicked(d.id)} />
          ))}
        </View>
      ) : (
        <Notice tone="warning">{t('carTrip.noDrivers')}</Notice>
      )}
      <Button testID="assign" kind={trip.driver ? 'outline' : 'primary'} label={t('carTrip.assign')} disabled={!picked || picked === trip.driver?.id} loading={busy} onPress={() => picked && onAssign(picked)} />
    </View>
  );
}

function InspectionForm({ phase, handoverKm, busy, onSave }: { phase: 'handover' | 'return'; handoverKm?: number; busy: boolean; onSave: (body: object) => void }) {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [tolls, setTolls] = useState('');
  const [parking, setParking] = useState('');
  const [damage, setDamage] = useState<Damage[]>([]);
  const [tried, setTried] = useState(false);
  const evidence = useEvidencePhotos();

  const readings = checkReadings(odometer, fuel, phase === 'return' ? handoverKm : undefined);
  const money = [fuelCost, tolls, parking].map(optionalPaise);
  const damagePaise = damage.map((d) => rupeesInputToPaise(d.amount));
  const badDamage = damage.some((d, i) => d.description.trim().length < 3 || damagePaise[i] === null || damagePaise[i]! < 100);
  const error = readings ? t(`carTrip.readingError.${readings}`, { km: handoverKm ?? 0 }) : money.some((m) => m === null) || badDamage ? t('carTrip.chargeError') : null;
  const driven = phase === 'return' && handoverKm !== undefined && /^\d+$/.test(odometer) ? Number(odometer) - handoverKm : null;

  async function submit() {
    setTried(true);
    if (error || busy) return;
    const base = { odometerKm: Number(odometer), fuelEighths: fuel!, notes: notes.trim() || undefined, photos: evidence.photos.length ? evidence.photos : undefined };
    if (phase === 'handover') return onSave(base);
    const [fuelPaise, tollsPaise, parkingPaise] = money as number[];
    const ok = await confirm({ title: t('carTrip.returnConfirmTitle'), body: t('carTrip.returnConfirmBody'), confirmLabel: t('carTrip.saveReturn'), cancelLabel: t('common.back') });
    if (!ok) return;
    onSave({
      ...base,
      ...(fuelPaise ? { fuelPaise } : {}),
      ...(tollsPaise ? { tollsPaise } : {}),
      ...(parkingPaise ? { parkingPaise } : {}),
      ...(damage.length ? { damage: damage.map((d, i) => ({ description: d.description.trim(), amountPaise: damagePaise[i]! })) } : {}),
    });
  }

  return (
    <View style={{ gap: space.md }} testID={`${phase}-form`}>
      <Notice tone="info">{t(`carTrip.${phase}Hint`)}</Notice>
      <Field testID={`${phase}-odometer`} label={t('carTrip.odometer')} value={odometer} onChangeText={(v) => setOdometer(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={7}
        hint={driven !== null && driven >= 0 ? t('carTrip.driven', { km: driven }) : undefined} />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('carTrip.fuel')}>
        <Txt variant="bold" size="sm">{t('carTrip.fuel')}</Txt>
        <View style={styles.chips}>
          {FUEL.map((f) => (
            <ChoiceChip key={f} testID={`${phase}-fuel-${f}`} label={f === 0 ? t('carTrip.empty') : f === 8 ? t('carTrip.full') : `${f}/8`} selected={fuel === f} onPress={() => setFuel(f)} />
          ))}
        </View>
      </View>
      {phase === 'return' ? (
        <>
          <Txt variant="bold" size="sm">{t('carTrip.extraCharges')}</Txt>
          <Txt size="xs" color={c.textMuted}>{t('carTrip.extraChargesHint')}</Txt>
          <View style={styles.three}>
            <View style={{ flex: 1 }}><Field testID="return-fuel-cost" label={t('carTrip.fuelCost')} prefix="₹" value={fuelCost} onChangeText={(v) => setFuelCost(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={8} /></View>
            <View style={{ flex: 1 }}><Field testID="return-tolls" label={t('carTrip.tolls')} prefix="₹" value={tolls} onChangeText={(v) => setTolls(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={8} /></View>
            <View style={{ flex: 1 }}><Field testID="return-parking" label={t('carTrip.parking')} prefix="₹" value={parking} onChangeText={(v) => setParking(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={7} /></View>
          </View>
          {damage.map((d, i) => (
            <View key={i} style={styles.damage}>
              <View style={{ flex: 2 }}>
                <Field testID={`damage-desc-${i}`} label={t('carTrip.damage')} value={d.description} onChangeText={(v) => setDamage(damage.map((x, j) => (j === i ? { ...x, description: v } : x)))} maxLength={200} placeholder={t('carTrip.damagePlaceholder')} />
              </View>
              <View style={{ flex: 1 }}>
                <Field testID={`damage-amount-${i}`} label={t('carTrip.amount')} prefix="₹" value={d.amount} onChangeText={(v) => setDamage(damage.map((x, j) => (j === i ? { ...x, amount: v.replace(/[^\d.]/g, '') } : x)))} keyboardType="decimal-pad" maxLength={9} />
              </View>
              <LinkButton testID={`damage-remove-${i}`} label={t('common.delete')} color={c.danger} onPress={() => setDamage(damage.filter((_, j) => j !== i))} />
            </View>
          ))}
          {damage.length < 10 ? <LinkButton testID="add-damage" label={t('carTrip.addDamage')} onPress={() => setDamage([...damage, { description: '', amount: '' }])} /> : null}
        </>
      ) : null}
      <Field testID={`${phase}-notes`} label={`${t('rental.note')} ${t('form.optional')}`} value={notes} onChangeText={setNotes} maxLength={500} multiline placeholder={t('carTrip.notesPlaceholder')} />
      <Button kind="outline" icon="image" testID={`${phase}-photos`} label={evidence.photos.length ? t('rental.photosAdded', { count: evidence.photos.length }) : t('carTrip.addPhotos')}
        loading={evidence.uploading} disabled={evidence.full} onPress={() => void evidence.add()} />
      {tried && error ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{error}</Txt> : null}
      <Button testID={`save-${phase}`} icon="check" label={t(phase === 'handover' ? 'carTrip.saveHandover' : 'carTrip.saveReturn')} loading={busy} onPress={() => void submit()} />
    </View>
  );
}

function InspectionLine({ inspection: i }: { inspection: TripInspection }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Row first testID={`inspection-${i.phase}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
      <View style={styles.line}>
        <Txt variant="bold" size="sm" style={{ flex: 1 }}>{t(`carTrip.phase.${i.phase}`)} · {formatDateTime(i.recordedAt, lang)}</Txt>
        {i.customerAck ? <Pill label={t(`carTrip.ack.${i.customerAck}`)} tone={i.customerAck === 'disputed' ? 'warning' : 'success'} /> : null}
      </View>
      <Txt size="sm">
        {t('carTrip.readings', { km: i.readings.odometerKm, fuel: i.readings.fuelEighths })}
        {i.readings.km !== undefined ? ` · ${t('carTrip.driven', { km: i.readings.km })}` : ''}
      </Txt>
      {i.notes ? <Txt size="xs" color={c.textMuted}>{`“${i.notes}”`}</Txt> : null}
      {i.customerNote ? <Txt size="xs" color={c.onWarning}>{t('carTrip.customerSays', { note: i.customerNote })}</Txt> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  three: { flexDirection: 'row', gap: space.sm },
  damage: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
});
