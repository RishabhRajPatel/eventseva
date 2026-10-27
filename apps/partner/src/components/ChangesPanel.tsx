import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking, type BookingChange } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { engineKeys, useChanges } from '../lib/engine';
import { invalidateBookings } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button } from './Button';
import { Card, CardHeader, Row } from './Card';
import { Pill } from './Chip';
import { ReasonSheet } from './ReasonSheet';
import { Txt } from './Txt';

/** Reschedules and extensions the customer asked for: approve (the new times are held) or decline. */
export function ChangesPanel({ booking }: { booking: Booking }) {
  const changes = useChanges(booking.id, booking.bookingType !== 'slot' && ['confirmed', 'accepted'].includes(booking.status));
  if (!changes.data?.length) return null;
  return <Panel booking={booking} changes={changes.data} />;
}

/** "+ ₹500 to pay" / "₹300 back" / "Same price". */
export function priceDiffLabel(t: TFunction, diff: number) {
  if (diff > 0) return t('changes.more', { amount: rupees(diff) });
  if (diff < 0) return t('changes.less', { amount: rupees(-diff) });
  return t('changes.same');
}

function Panel({ booking, changes }: { booking: Booking; changes: BookingChange[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const [declining, setDeclining] = useState<string | null>(null);
  const done = (items: BookingChange[], message: string) => {
    qc.setQueryData(engineKeys.changes(booking.id), items);
    invalidateBookings(qc, booking.id);
    toast.success(message);
  };
  const approve = useMutation({
    mutationFn: (id: string) => api.post<{ items: BookingChange[] }>(`/v1/partner/bookings/${booking.id}/changes/${id}/approve`),
    onSuccess: (r) => done(r.items, t('changes.approved')),
    onError: (e) => toast.error(errorText(t, e)),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<{ items: BookingChange[] }>(`/v1/partner/bookings/${booking.id}/changes/${id}/reject`, { reason }),
    onSuccess: (r) => {
      done(r.items, t('changes.declined'));
      setDeclining(null);
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  return (
    <Card testID="changes-panel">
      <CardHeader title={t('changes.title')} />
      {changes.map((ch, i) => (
        <Row key={ch.id} first={i === 0} style={{ flexDirection: 'column', alignItems: 'stretch', gap: space.xs }} testID={`change-${ch.id}`}>
          <View style={styles.line}>
            <Txt variant="bold" size="md" style={{ flex: 1 }}>{t(`changes.kind.${ch.kind}`)}</Txt>
            <Pill label={t(`changes.status.${ch.status}`)} tone={ch.status === 'requested' ? 'warning' : ch.status === 'approved' ? 'success' : 'neutral'} />
          </View>
          <Txt size="sm">{t('changes.newTimes', { from: formatDateTime(ch.startsAt, lang), until: formatDateTime(ch.endsAt, lang) })}</Txt>
          <Txt size="sm" color={c.textMuted}>{priceDiffLabel(t, ch.priceDiffPaise)}</Txt>
          {ch.reason ? <Txt size="xs" color={c.textMuted}>{`“${ch.reason}”`}</Txt> : null}
          {ch.status === 'requested' ? (
            <View style={styles.line}>
              <Button testID={`decline-change-${ch.id}`} kind="outline" label={t('requests.decline')} style={{ flex: 1 }} disabled={approve.isPending} onPress={() => setDeclining(ch.id)} />
              <Button testID={`approve-change-${ch.id}`} icon="check" label={t('changes.approve')} style={{ flex: 1 }} loading={approve.isPending && approve.variables === ch.id} onPress={() => approve.mutate(ch.id)} />
            </View>
          ) : null}
        </Row>
      ))}
      <ReasonSheet
        visible={!!declining}
        title={t('changes.declineTitle')}
        message={t('changes.declineBody')}
        quickReasons={[t('reason.alreadyBooked'), t('reason.notAvailable')]}
        confirmLabel={t('requests.declineConfirm')}
        loading={reject.isPending}
        onClose={() => setDeclining(null)}
        onConfirm={(reason) => declining && !reject.isPending && reject.mutate({ id: declining, reason })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
