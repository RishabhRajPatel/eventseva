// Rental bookings on the booking screen: the items as booked, where the delivery is, the security
// deposit (pay it here), and damage / missing charges to accept or dispute.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking, type RentalCharge, type RentalView } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { choosePaymentPath, payAdvance } from '../lib/payments';
import { keys } from '../lib/queryClient';
import { useMe } from '../lib/session';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Card, Divider, MoneyRow, Notice, Pill } from './Bits';
import { Button } from './Button';
import { EvidencePhotos } from './EvidencePhotos';
import { TextField } from './Form';
import { useToast } from './Toast';

/** The step the customer sees, in the order rentals go. */
export const RENTAL_STEPS = ['confirmed', 'preparing', 'dispatched', 'delivered', 'return_pending', 'returned_verified'] as const;

export const rentalKey = (bookingId: string) => ['rental', bookingId] as const;

export function RentalSection({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const rental = useQuery({ queryKey: rentalKey(booking.id), queryFn: () => api.rental(booking.id) });
  if (!rental.data) return null;
  const r = rental.data;
  const stepIndex = RENTAL_STEPS.indexOf(booking.stage as (typeof RENTAL_STEPS)[number]);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <AppText variant="bold" size="md" style={styles.flex}>
          {t('rent.items')}
        </AppText>
        <Pill label={t(`stage.${booking.stage}`)} tone={booking.stage === 'returned_verified' || booking.stage === 'completed' ? 'mint' : 'lavender'} />
      </View>
      <AppText size="sm">{t('rent.window', { from: formatDateTime(r.startsAt, lang), until: formatDateTime(r.returnDueAt ?? r.endsAt, lang) })}</AppText>
      {stepIndex >= 0 ? (
        <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={t(`stage.${booking.stage}`)}>
          {RENTAL_STEPS.map((s, i) => (
            <View key={s} style={[styles.step, i <= stepIndex && styles.stepDone]} />
          ))}
        </View>
      ) : null}

      {r.lines.map((l) => (
        <View key={l.id} style={styles.line} testID={`rental-line-${l.id}`}>
          <View style={styles.head}>
            <AppText size="md" style={styles.flex}>
              {`${l.item.name} × ${l.qty}`}
            </AppText>
            <AppText size="md" variant="bold">
              {rupees(l.amountPaise)}
            </AppText>
          </View>
          {l.dispatchedQty ? (
            <AppText size="xs" color={c.textMuted}>
              {t('rent.lineCounts', { delivered: l.deliveredQty, back: l.returnedQty, damaged: l.damagedQty, missing: l.missingQty })}
            </AppText>
          ) : null}
        </View>
      ))}

      {r.steps.filter((st) => st.photoIds.length).map((st) => (
        <View key={st.phase} style={{ gap: 2 }}>
          <AppText size="xs" color={c.textMuted}>{t(`rent.stepPhotos.${st.phase}`)}</AppText>
          <EvidencePhotos ids={st.photoIds} label={t(`rent.stepPhotos.${st.phase}`)} />
        </View>
      ))}
      <Divider />
      <Deposit booking={booking} deposit={r.deposit} closed={r.fulfilment === 'closed'} queryKey={rentalKey(booking.id)} />
      {r.charges.length ? <Charges booking={booking} charges={r.charges} queryKey={rentalKey(booking.id)} /> : null}
      {r.dueToVendorPaise ? <Notice tone="peach">{t('rent.dueToVendor', { amount: rupees(r.dueToVendorPaise) })}</Notice> : null}
      <Balance booking={booking} duePaise={r.balanceDuePaise} queryKey={rentalKey(booking.id)} />
    </Card>
  );
}

/** The refundable security deposit: what is asked, paid, kept; pay it before the items go out (or the car). */
export function Deposit({ booking, deposit: d, closed, queryKey }: { booking: Booking; deposit: RentalView['deposit']; closed: boolean; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const toast = useToast();
  const pay = useMutation({
    mutationFn: () => payAdvance(booking, { name: me.name, phone: me.phone }, choosePaymentPath(), undefined, 'deposit'),
    onSuccess: (result) => {
      if (result.status !== 'paid') return;
      toast.success(t('rent.depositPaid'));
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: keys.booking(booking.id) });
    },
  });
  if (!d.requiredPaise) return <AppText size="sm">{t('rent.noDeposit')}</AppText>;
  const cash = booking.payMode === 'cash';
  const due = booking.status === 'confirmed' && d.paidPaise < d.requiredPaise && !closed && !cash;
  return (
    <View style={{ gap: space.xs }}>
      <MoneyRow label={t('rent.deposit')} value={rupees(d.requiredPaise)} />
      {d.paidPaise ? <MoneyRow label={t('rent.depositPaidLine')} value={rupees(d.paidPaise)} small /> : null}
      {cash && booking.status === 'confirmed' && d.paidPaise < d.requiredPaise ? (
        <AppText size="xs" color={c.textMuted}>{t('cash.depositHint')}</AppText>
      ) : null}
      {d.settledAt ? (
        <MoneyRow label={t('rent.depositKept')} value={rupees(d.keptPaise)} small />
      ) : null}
      {due ? (
        <>
          <AppText size="xs" color={c.textMuted}>
            {t('rent.depositHint')}
          </AppText>
          <Button testID="pay-deposit" label={t('rent.payDeposit', { amount: rupees(d.requiredPaise - d.paidPaise) })} variant="secondary" size="md" onPress={() => pay.mutateAsync()} />
          {pay.error ? (
            <AppText size="sm" color={c.danger}>
              {errorText(t, pay.error)}
            </AppText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** The rest of the price, plus agreed charges the deposit did not cover, paid online. */
export function Balance({ booking, duePaise, queryKey }: { booking: Booking; duePaise: number; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const toast = useToast();
  const pay = useMutation({
    mutationFn: () => payAdvance(booking, { name: me.name, phone: me.phone }, choosePaymentPath(), undefined, 'balance'),
    onSuccess: (result) => {
      if (result.status !== 'paid') return;
      toast.success(t('rent.balancePaid'));
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: keys.booking(booking.id) });
    },
  });
  if (!duePaise) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Button testID="pay-balance" label={t('rent.payBalance', { amount: rupees(duePaise) })} size="md" onPress={() => pay.mutateAsync()} />
      {pay.error ? (
        <AppText size="sm" color={c.danger}>
          {errorText(t, pay.error)}
        </AppText>
      ) : null}
    </View>
  );
}

/** Damage / extra charges the vendor added: accept, or dispute with a reason (EventSeva decides). */
export function Charges({ booking, charges, queryKey }: { booking: Booking; charges: RentalCharge[]; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const [disputing, setDisputing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const answer = useMutation({
    mutationFn: (v: { id: string; decision: 'accept' | 'dispute'; note?: string }) => api.answerCharge(booking.id, v.id, v.decision, v.note),
    onSuccess: (r) => {
      qc.setQueryData(queryKey, r);
      setDisputing(null);
      setReason('');
    },
  });
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bold" size="sm">
        {t('rent.charges')}
      </AppText>
      {charges.map((ch) => (
        <View key={ch.id} style={styles.charge} testID={`charge-${ch.id}`}>
          <View style={styles.head}>
            <AppText size="sm" style={styles.flex}>
              {ch.description}
            </AppText>
            <AppText size="sm" variant="bold">
              {rupees(ch.amountPaise)}
            </AppText>
          </View>
          <AppText size="xs" color={c.textMuted}>
            {ch.status === 'proposed' ? t('rent.replyBy', { time: formatDateTime(ch.replyBy, lang) }) : t(`rent.chargeStatus.${ch.status}`)}
          </AppText>
          {ch.status === 'proposed' && disputing !== ch.id ? (
            <View style={styles.buttons}>
              <Button testID={`accept-${ch.id}`} label={t('rent.accept')} size="md" variant="secondary" style={styles.flex} onPress={() => answer.mutateAsync({ id: ch.id, decision: 'accept' })} />
              <Button testID={`dispute-${ch.id}`} label={t('rent.dispute')} size="md" variant="outline" style={styles.flex} onPress={() => setDisputing(ch.id)} />
            </View>
          ) : null}
          {disputing === ch.id ? (
            <View style={{ gap: space.sm }}>
              <TextField label={t('rent.disputeReason')} value={reason} onChangeText={setReason} maxLength={500} multiline placeholder={t('rent.disputePlaceholder')} />
              <Button testID={`send-dispute-${ch.id}`} label={t('rent.sendDispute')} size="md" disabled={reason.trim().length < 3}
                onPress={() => answer.mutateAsync({ id: ch.id, decision: 'dispute', note: reason.trim() })} />
            </View>
          ) : null}
        </View>
      ))}
      {answer.error ? (
        <AppText size="sm" color={c.danger}>
          {errorText(t, answer.error)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  line: { gap: 2 },
  steps: { flexDirection: 'row', gap: 4 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.lavender },
  stepDone: { backgroundColor: c.royal },
  charge: { gap: space.xs, paddingVertical: space.xs },
  buttons: { flexDirection: 'row', gap: space.sm },
});
