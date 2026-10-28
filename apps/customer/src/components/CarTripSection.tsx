// Car bookings on the booking screen: route, car and driver, the handover / return records to agree
// with or dispute, extra charges, the security deposit (self-drive) and the balance.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type Booking, type TripInspection } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Card, Divider, Pill } from './Bits';
import { Button } from './Button';
import { TextField } from './Form';
import { EvidencePhotos } from './EvidencePhotos';
import { Balance, Charges, Deposit } from './RentalSection';

export const tripKey = (bookingId: string) => ['trip', bookingId] as const;

export function CarTripSection({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const trip = useQuery({ queryKey: tripKey(booking.id), queryFn: () => api.trip(booking.id) });
  if (!trip.data) return null;
  const v = trip.data;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <AppText variant="bold" size="md" style={styles.flex}>
          {t('carTrip.title')}
        </AppText>
        <Pill label={t(`carTrip.fulfilment.${v.fulfilment}`)} tone={v.fulfilment === 'closed' ? 'mint' : 'lavender'} />
      </View>
      <AppText size="sm">{t('rent.window', { from: formatDateTime(v.startsAt, lang), until: formatDateTime(v.endsAt, lang) })}</AppText>
      <AppText size="sm">{t(`engineBook.modes.${v.mode}`)}</AppText>
      {v.vehicle ? <AppText size="sm">{[v.vehicle.name, v.vehicle.registration].filter(Boolean).join(' · ')}</AppText> : null}
      {v.driver ? <AppText size="sm">{t('carTrip.driver', { name: v.driver.name })}</AppText> : null}
      {v.route ? (
        <>
          <AppText size="sm">{t('carTrip.pickup', { place: v.route.pickup.address })}</AppText>
          <AppText size="sm">{t('carTrip.drop', { place: v.route.destination.address })}</AppText>
        </>
      ) : null}
      {v.inspections.map((i) => (
        <Inspection key={i.phase} booking={booking} inspection={i} />
      ))}
      <Divider />
      <Deposit booking={booking} deposit={v.deposit} closed={v.fulfilment !== 'scheduled' && v.fulfilment !== 'assigned'} queryKey={tripKey(booking.id)} />
      {v.charges.length ? <Charges booking={booking} charges={v.charges} queryKey={tripKey(booking.id)} /> : null}
      <Balance booking={booking} duePaise={v.balanceDuePaise} queryKey={tripKey(booking.id)} />
    </Card>
  );
}

/** The vendor's odometer / fuel record: agree, or say what is wrong (EventSeva sees it). */
function Inspection({ booking, inspection: i }: { booking: Booking; inspection: TripInspection }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const ack = useMutation({
    mutationFn: (v: { decision: 'agreed' | 'disputed'; note?: string }) => api.ackInspection(booking.id, i.phase, v.decision, v.note),
    onSuccess: (view) => {
      qc.setQueryData(tripKey(booking.id), view);
      setDisputing(false);
    },
  });
  return (
    <View style={styles.inspection} testID={`inspection-${i.phase}`}>
      <AppText variant="bold" size="sm">
        {t(`carTrip.phase.${i.phase}`)} · {formatDateTime(i.recordedAt, lang)}
      </AppText>
      <AppText size="sm">
        {t('carTrip.readings', { km: i.readings.odometerKm, fuel: i.readings.fuelEighths })}
        {i.readings.km !== undefined ? ` · ${t('carTrip.driven', { km: i.readings.km })}` : ''}
      </AppText>
      {i.notes ? <AppText size="xs" color={c.textMuted}>{`“${i.notes}”`}</AppText> : null}
      <EvidencePhotos ids={i.photoIds} label={t(`carTrip.phase.${i.phase}`)} />
      {i.customerAck ? (
        <AppText size="xs" color={i.customerAck === 'disputed' ? c.warningText : c.successText}>
          {t(`carTrip.ack.${i.customerAck}`)}
        </AppText>
      ) : disputing ? (
        <View style={styles.gap}>
          <TextField label={t('carTrip.whatIsWrong')} value={note} onChangeText={setNote} maxLength={500} multiline />
          <Button label={t('rent.sendDispute')} size="md" disabled={note.trim().length < 3} onPress={() => ack.mutateAsync({ decision: 'disputed', note: note.trim() })} />
        </View>
      ) : (
        <View style={styles.buttons}>
          <Button label={t('carTrip.agree')} size="md" variant="secondary" style={styles.flex} onPress={() => ack.mutateAsync({ decision: 'agreed' })} />
          <Button label={t('carTrip.notRight')} size="md" variant="outline" style={styles.flex} onPress={() => setDisputing(true)} />
        </View>
      )}
      {ack.error ? <AppText size="sm" color={c.danger}>{errorText(t, ack.error)}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  inspection: { gap: 2, paddingVertical: space.xs },
  gap: { gap: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm },
});
