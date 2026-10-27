// Asking to move or extend a confirmed booking (engine bookings only). The vendor approves or declines;
// a higher price is added to the balance, a lower one refunded.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatClock, formatDateTime, formatDay, rupees, todayIst, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { EXTEND_HOURS, extendedEnd, istDayOf, movedTimes, START_TIMES } from '../lib/engine';
import { errorText } from '../lib/errors';
import { keys } from '../lib/queryClient';
import { addDaysTo } from '../lib/rental';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Card, Pill } from './Bits';
import { Button } from './Button';
import { Chip, TextField } from './Form';
import { useToast } from './Toast';

export const changesKey = (bookingId: string) => ['changes', bookingId] as const;

/** Changes can be asked while the booking is accepted or confirmed and not finished. */
export const canAskChange = (b: Pick<Booking, 'bookingType' | 'status' | 'stage'>) =>
  b.bookingType !== 'slot' && (b.status === 'accepted' || b.status === 'confirmed') && !['returned_verified', 'completed'].includes(b.stage);

export function ChangesSection({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: changesKey(b.id), queryFn: () => api.changes(b.id), enabled: b.bookingType !== 'slot' });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'extension' | 'reschedule'>('extension');
  const [hours, setHours] = useState<number>(EXTEND_HOURS[1]);
  const startDay = b.startsAt ? istDayOf(b.startsAt) : b.day;
  const [day, setDay] = useState(startDay);
  const [time, setTime] = useState(b.startsAt ? new Date(Date.parse(b.startsAt) + 5.5 * 3_600_000).toISOString().slice(11, 16) : '18:00');
  const [reason, setReason] = useState('');
  const started = !['confirmed', 'pending_confirmation', 'awaiting_payment', 'preparing'].includes(b.stage);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: changesKey(b.id) });
    void qc.invalidateQueries({ queryKey: keys.booking(b.id) });
  };
  const ask = useMutation({
    mutationFn: () => {
      if (!b.startsAt || !b.endsAt) throw new Error('no times');
      const body =
        kind === 'extension'
          ? { kind, endsAt: extendedEnd(b.endsAt, hours) }
          : { kind, ...movedTimes(b.startsAt, b.endsAt, day, time) };
      return api.requestChange(b.id, { ...body, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    },
    onSuccess: () => {
      toast.success(t('changes.sent'));
      setOpen(false);
      setReason('');
      refresh();
    },
  });
  const withdraw = useMutation({ mutationFn: (changeId: string) => api.cancelChange(b.id, changeId), onSuccess: refresh });

  const items = list.data?.items ?? [];
  const pending = items.some((x) => x.status === 'requested');
  if (!canAskChange(b) && !items.length) return null;

  return (
    <Card style={styles.card}>
      <AppText variant="bold" size="md">{t('changes.title')}</AppText>
      {items.map((ch) => (
        <View key={ch.id} style={styles.item} testID={`change-${ch.id}`}>
          <View style={styles.row}>
            <AppText size="sm" variant="bold" style={styles.flex}>{t(`changes.kind.${ch.kind}`)}</AppText>
            <Pill label={t(`changes.status.${ch.status}`)} tone={ch.status === 'approved' ? 'mint' : ch.status === 'requested' ? 'peach' : 'lavender'} />
          </View>
          <AppText size="sm">{t('rent.window', { from: formatDateTime(ch.startsAt, lang), until: formatDateTime(ch.endsAt, lang) })}</AppText>
          <AppText size="xs" color={c.textMuted}>
            {ch.priceDiffPaise > 0 ? t('changes.more', { amount: rupees(ch.priceDiffPaise) }) : ch.priceDiffPaise < 0 ? t('changes.less', { amount: rupees(-ch.priceDiffPaise) }) : t('changes.same')}
          </AppText>
          {ch.status === 'rejected' && ch.reason ? <AppText size="xs" color={c.textMuted}>{`“${ch.reason}”`}</AppText> : null}
          {ch.status === 'requested' ? <Button label={t('changes.withdraw')} variant="ghost" size="md" onPress={() => withdraw.mutateAsync(ch.id)} /> : null}
        </View>
      ))}
      {canAskChange(b) && !pending && !open ? <Button label={t('changes.ask')} variant="outline" size="md" onPress={() => setOpen(true)} /> : null}
      {open ? (
        <View style={styles.gap}>
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip label={t('changes.kind.extension')} selected={kind === 'extension'} onPress={() => setKind('extension')} />
            {!started ? <Chip label={t('changes.kind.reschedule')} selected={kind === 'reschedule'} onPress={() => setKind('reschedule')} /> : null}
          </View>
          {kind === 'extension' ? (
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('changes.howMuchLonger')}>
              {EXTEND_HOURS.map((h) => (
                <Chip key={h} label={h === 24 ? t('engineBook.days', { count: 1 }) : `+${t('engineBook.hours', { count: h })}`} selected={hours === h} onPress={() => setHours(h)} />
              ))}
            </View>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
                {[-1, 0, 1, 2, 3, 7].map((o) => {
                  const d = addDaysTo(startDay, o);
                  return <Chip key={o} label={formatDay(d, lang).replace(/ \d{4}$/, '')} selected={day === d} disabled={d < todayIst()} onPress={() => setDay(d)} />;
                })}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
                {START_TIMES.map((x) => (
                  <Chip key={x} label={formatClock(x)} selected={time === x} onPress={() => setTime(x)} />
                ))}
              </ScrollView>
            </>
          )}
          <TextField label={t('changes.why')} value={reason} onChangeText={setReason} maxLength={300} />
          <AppText size="xs" color={c.textMuted}>{t('changes.priceNote')}</AppText>
          <Button label={t('changes.send')} size="md" onPress={() => ask.mutateAsync()} />
          {ask.error ? <AppText size="sm" color={c.danger}>{errorText(t, ask.error)}</AppText> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  item: { gap: 2, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  gap: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
