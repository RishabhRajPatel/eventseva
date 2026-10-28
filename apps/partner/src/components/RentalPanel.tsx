import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, rupees, type Booking, type RentalLine, type RentalView } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { confirm } from '../lib/confirm';
import { errorText } from '../lib/errors';
import { invalidateInventory, inventoryKeys, itemUnit, nextStep, useRental } from '../lib/inventory';
import { invalidateBookings } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { customerCode } from '../lib/handoverCode';
import { useEvidencePhotos } from '../hooks/useEvidencePhotos';
import { useLang } from '../hooks/useLang';
import { Button } from './Button';
import { Card, CardHeader, Row } from './Card';
import { Pill } from './Chip';
import { Field } from './Field';
import { Notice } from './Notice';
import { QueryView } from './States';
import { Txt } from './Txt';

type Counts = Record<string, { returned: string; damaged: string; missing: string; charge: string }>;
const n = (v: string) => (v.trim() ? Number(v.replace(/\D/g, '')) : 0);

/** Rental bookings: items, and the vendor's next step (prepare, dispatch, deliver, count the return, verify). */
export function RentalPanel({ booking }: { booking: Booking }) {
  const rental = useRental(booking.id, booking.bookingType === 'rental');
  return <QueryView query={rental}>{(r) => <Panel booking={booking} rental={r} />}</QueryView>;
}

function Panel({ booking, rental }: { booking: Booking; rental: RentalView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const counted = rental.steps.some((s) => s.phase === 'return');
  const step = booking.status === 'confirmed' ? nextStep(rental.fulfilment, counted) : 'done';
  const [qty, setQty] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Counts>({});
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const { photos, uploading, add: addPhotos, clear: clearPhotos, full } = useEvidencePhotos();

  const done = (r: RentalView) => {
    qc.setQueryData(inventoryKeys.rental(booking.id), r);
    invalidateBookings(qc, booking.id);
    invalidateInventory(qc);
    setNote('');
    setCode('');
    clearPhotos();
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => api.post<RentalView>(`/v1/partner/bookings/${booking.id}/rental/${path}`, body ?? {}),
    onSuccess: (r, v) => {
      done(r);
      toast.success(t(`rental.done.${v.path}`));
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  const lineQty = (l: RentalLine, fallback: number) => (qty[l.id] !== undefined ? n(qty[l.id]) : fallback);
  const lineCounts = (l: RentalLine) => counts[l.id] ?? { returned: String(l.dispatchedQty), damaged: '', missing: '', charge: '' };
  const charge = (l: RentalLine) => {
    const k = lineCounts(l);
    return n(k.damaged) * l.damagePaise + n(k.missing) * l.missingPaise;
  };
  const mismatched = rental.lines.filter((l) => l.dispatchedQty > 0).filter((l) => {
    const k = lineCounts(l);
    return n(k.returned) + n(k.damaged) + n(k.missing) !== l.dispatchedQty;
  });

  const evidence = (
    <View style={{ gap: space.sm }}>
      <Field testID="rental-note" label={t('rental.note')} value={note} onChangeText={setNote} maxLength={500} placeholder={t('rental.notePlaceholder')} />
      <Button kind="outline" icon="image" testID="rental-photos" label={photos.length ? t('rental.photosAdded', { count: photos.length }) : t('rental.addPhotos')} loading={uploading}
        disabled={full} onPress={() => void addPhotos()} />
    </View>
  );
  const body = () => ({ note: note.trim() || undefined, photos: photos.length ? photos : undefined });
  // Delivery and return: the customer's code shows they were there and agree with the count.
  const codeField = (
    <Field testID="customer-code" label={`${t('handoverCode.label')} ${t('form.optional')}`} hint={t('handoverCode.hint')} value={code}
      onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} />
  );

  return (
    <Card style={{ gap: space.md }} testID="rental-panel">
      <CardHeader title={t('rental.items')} right={<Pill label={t(`stage.${booking.stage}`)} tone="info" />} />
      <Txt size="sm" color={c.textMuted}>
        {t('rental.window', { from: formatDateTime(rental.startsAt, lang), until: formatDateTime(rental.returnDueAt ?? rental.endsAt, lang) })}
      </Txt>

      {rental.lines.map((l, i) => (
        <Row key={l.id} first={i === 0} style={{ flexDirection: 'column', alignItems: 'stretch', gap: space.sm }}>
          <View style={styles.lineHead}>
            <Txt variant="bold" size="md" style={{ flex: 1 }}>{l.item.name}</Txt>
            <Txt size="md">{l.qty} {itemUnit(t, l.item.unit)}</Txt>
          </View>
          <Txt size="xs" color={c.textMuted}>
            {t('rental.lineMoney', { amount: rupees(l.amountPaise), damage: rupees(l.damagePaise), missing: rupees(l.missingPaise) })}
          </Txt>
          {l.dispatchedQty ? (
            <Txt size="xs" color={c.textMuted} testID={`line-counts-${l.id}`}>
              {t('rental.lineCounts', { sent: l.dispatchedQty, delivered: l.deliveredQty, back: l.returnedQty, damaged: l.damagedQty, missing: l.missingQty })}
            </Txt>
          ) : null}
          {step === 'dispatch' || step === 'prepare' ? (
            <Field testID={`dispatch-qty-${l.id}`} label={t('rental.sendQty')} value={qty[l.id] ?? String(l.qty)} onChangeText={(v) => setQty({ ...qty, [l.id]: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={6} />
          ) : null}
          {step === 'deliver' ? (
            <Field testID={`deliver-qty-${l.id}`} label={t('rental.deliveredQty')} value={qty[l.id] ?? String(l.dispatchedQty)} onChangeText={(v) => setQty({ ...qty, [l.id]: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={6} />
          ) : null}
          {step === 'return' && l.dispatchedQty ? (
            <View style={{ gap: space.xs }}>
              <View style={styles.three}>
                {(['returned', 'damaged', 'missing'] as const).map((k) => (
                  <View key={k} style={{ flex: 1 }}>
                    <Field testID={`return-${k}-${l.id}`} label={t(`rental.${k}`)} value={lineCounts(l)[k]} keyboardType="number-pad" maxLength={6}
                      onChangeText={(v) => setCounts({ ...counts, [l.id]: { ...lineCounts(l), [k]: v.replace(/\D/g, '') } })} />
                  </View>
                ))}
              </View>
              {charge(l) ? (
                <Txt size="sm" color={c.onWarning} testID={`charge-${l.id}`}>{t('rental.chargePreview', { amount: rupees(charge(l)) })}</Txt>
              ) : null}
            </View>
          ) : null}
        </Row>
      ))}

      {step === 'prepare' ? (
        <Button testID="rental-prepare" label={t('rental.prepare')} loading={act.isPending} onPress={() => act.mutate({ path: 'prepare' })} />
      ) : null}
      {step === 'dispatch' || step === 'prepare' ? (
        <>
          {step === 'dispatch' ? evidence : null}
          <Button testID="rental-dispatch" kind={step === 'prepare' ? 'outline' : 'primary'} icon="navigate" label={t('rental.dispatch')} loading={act.isPending}
            onPress={() => act.mutate({ path: 'dispatch', body: { lines: rental.lines.map((l) => ({ lineId: l.id, qty: lineQty(l, l.qty) })), ...body() } })} />
        </>
      ) : null}
      {step === 'deliver' ? (
        <>
          {evidence}
          {codeField}
          <Button testID="rental-deliver" icon="check" label={t('rental.deliver')} loading={act.isPending}
            onPress={() => act.mutate({ path: 'deliver', body: { lines: rental.lines.map((l) => ({ lineId: l.id, qty: lineQty(l, l.dispatchedQty) })), ...body(), ...customerCode(code) } })} />
        </>
      ) : null}
      {step === 'return' ? (
        <>
          <Notice tone="info">{t('rental.returnHint')}</Notice>
          {evidence}
          {codeField}
          {mismatched.length ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{t('rental.countMismatch', { name: mismatched[0].item.name, sent: mismatched[0].dispatchedQty })}</Txt> : null}
          <Button testID="rental-return" label={t('rental.saveReturn')} loading={act.isPending} disabled={mismatched.length > 0}
            onPress={() =>
              act.mutate({
                path: 'return',
                body: {
                  lines: rental.lines.filter((l) => l.dispatchedQty > 0).map((l) => {
                    const k = lineCounts(l);
                    return { lineId: l.id, returned: n(k.returned), damaged: n(k.damaged), missing: n(k.missing) };
                  }),
                  ...body(),
                  ...customerCode(code),
                },
              })
            } />
        </>
      ) : null}
      {step === 'verify' ? (
        <>
          <Notice tone="warning" title={t('rental.verifyTitle')}>{t('rental.verifyBody')}</Notice>
          <Button testID="rental-recount" kind="outline" label={t('rental.recount')} onPress={() => act.mutate({ path: 'return', body: { lines: rental.lines.filter((l) => l.dispatchedQty > 0).map((l) => ({ lineId: l.id, returned: l.returnedQty, damaged: l.damagedQty, missing: l.missingQty })) } })} />
          <Button testID="rental-verify" icon="check" label={t('rental.verify')} loading={act.isPending}
            onPress={async () => {
              const ok = await confirm({ title: t('rental.verifyConfirmTitle'), body: t('rental.verifyConfirmBody'), confirmLabel: t('rental.verify'), cancelLabel: t('common.back') });
              if (ok) act.mutate({ path: 'verify' });
            }} />
        </>
      ) : null}

      {rental.charges.length ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="bold" size="sm">{t('rental.charges')}</Txt>
          {rental.charges.map((ch) => (
            <View key={ch.id} style={styles.lineHead}>
              <Txt size="sm" style={{ flex: 1 }}>{ch.description}</Txt>
              <Txt size="sm" variant="bold">{rupees(ch.amountPaise)}</Txt>
              <Pill label={t(`rental.chargeStatus.${ch.status}`)} tone={ch.status === 'disputed' ? 'warning' : ch.status === 'proposed' ? 'neutral' : 'success'} />
            </View>
          ))}
        </View>
      ) : null}
      <Txt size="sm" color={c.textMuted} testID="rental-deposit">
        {rental.deposit.requiredPaise
          ? t('rental.depositLine', { paid: rupees(rental.deposit.paidPaise), required: rupees(rental.deposit.requiredPaise) }) +
            (rental.deposit.settledAt ? ` · ${t('rental.depositKept', { amount: rupees(rental.deposit.keptPaise) })}` : '')
          : t('rental.noDeposit')}
      </Txt>
      {rental.dueToVendorPaise ? <Notice tone="info">{t('rental.dueToVendor', { amount: rupees(rental.dueToVendorPaise) })}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  three: { flexDirection: 'row', gap: space.sm },
});
