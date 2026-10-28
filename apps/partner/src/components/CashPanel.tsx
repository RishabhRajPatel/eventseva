// Cash bookings: what the customer owes in person, the cash recorded so far, and a form to record
// cash taken or given back (the customer is told each time).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking, type CashKind, type CashSummary } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { cashKey, cashKinds } from '../lib/cash';
import { errorText } from '../lib/errors';
import { rupeesInputToPaise } from '../lib/money';
import { invalidateBookings } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button } from './Button';
import { Card, CardHeader, Row } from './Card';
import { ChoiceChip } from './Chip';
import { Field } from './Field';
import { Notice } from './Notice';
import { Txt } from './Txt';

export function CashPanel({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const cash = useQuery({ queryKey: cashKey(booking.id), queryFn: () => api.get<CashSummary>(`/v1/partner/bookings/${booking.id}/cash`) });
  const [kind, setKind] = useState<CashKind | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: (body: { kind: CashKind; amountPaise: number; note?: string }) => api.post<CashSummary>(`/v1/partner/bookings/${booking.id}/cash`, body),
    onSuccess: (s) => {
      qc.setQueryData(cashKey(booking.id), s);
      invalidateBookings(qc, booking.id);
      setKind(null);
      setAmount('');
      setNote('');
      toast.success(t('cash.saved'));
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  if (!cash.data) return null;
  const s = cash.data;
  const kinds = cashKinds(booking, s);
  const paise = rupeesInputToPaise(amount);
  return (
    <Card style={{ gap: space.md }} testID="cash-panel">
      <CardHeader title={t('cash.title')} />
      <Notice icon="rupee" tone="info">{t('cash.vendorNote', { amount: rupees(s.amountPaise), commission: rupees(booking.commissionPaise ?? 0) })}</Notice>
      <View style={styles.line}>
        <Txt size="md" style={{ flex: 1 }}>{t('cash.received')}</Txt>
        <Txt size="md" variant="bold" testID="cash-received">{rupees(s.receivedPaise)} / {rupees(s.amountPaise)}</Txt>
      </View>
      {s.depositPaise ? (
        <View style={styles.line}>
          <Txt size="md" style={{ flex: 1 }}>{t('cash.depositHeld')}</Txt>
          <Txt size="md" variant="bold">{rupees(s.depositHeldPaise)} / {rupees(s.depositPaise)}</Txt>
        </View>
      ) : null}
      {s.receipts.map((r, i) => (
        <Row key={r.id} first={i === 0}>
          <View style={{ flex: 1 }}>
            <Txt size="sm">{t(`cash.kind.${r.kind}`)} · {formatDateTime(r.createdAt, lang)}</Txt>
            {r.note ? <Txt size="xs" color={c.textMuted}>{r.note}</Txt> : null}
          </View>
          <Txt size="sm" variant="bold">{['refund', 'deposit_return'].includes(r.kind) ? '−' : ''}{rupees(r.amountPaise)}</Txt>
        </Row>
      ))}
      {kinds.length ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="bold" size="sm">{t('cash.record')}</Txt>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {kinds.map((k) => (
              <ChoiceChip key={k} testID={`cash-kind-${k}`} label={t(`cash.kind.${k}`)} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
          {kind ? (
            <>
              <Field testID="cash-amount" label={t('cash.amount')} prefix="₹" value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={9} />
              <Field testID="cash-note" label={`${t('cash.note')} ${t('form.optional')}`} value={note} onChangeText={setNote} maxLength={300} />
              <Button testID="cash-save" icon="check" label={t('cash.save')} loading={save.isPending} disabled={!paise}
                onPress={() => paise && save.mutate({ kind, amountPaise: paise, note: note.trim() || undefined })} />
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
