// The invoice for a confirmed booking, issued in the vendor's name: view it and share it.
import { Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDateTime, invoiceText, rupees, type Invoice } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { c, space } from '../../lib/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { Card, Divider, MoneyRow } from '../../components/Bits';
import { Button } from '../../components/Button';
import { Screen, ScreenHeader } from '../../components/Screen';
import { CardsSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/States';

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => api.invoice(id), staleTime: 5 * 60_000 });
  if (invoice.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('invoice.title')} />
        <CardsSkeleton count={2} height={140} />
      </Screen>
    );
  }
  if (invoice.error) {
    return (
      <Screen>
        <ScreenHeader title={t('invoice.title')} />
        <ErrorState error={invoice.error} onRetry={() => invoice.refetch()} />
      </Screen>
    );
  }
  const inv = invoice.data;
  return (
    <Screen scroll footer={<Button label={t('invoice.share')} icon="send" onPress={() => void Share.share({ message: invoiceText(inv) })} />}>
      <ScreenHeader title={invoiceTitle(t, inv)} subtitle={inv.number === 'PROFORMA' ? t('invoice.notFinal') : inv.number} />
      <InvoiceBody invoice={inv} />
    </Screen>
  );
}

/** Proforma until the booking is completed; then a tax invoice or a bill of supply. */
export function invoiceTitle(t: TFunction, inv: Pick<Invoice, 'title'>) {
  return inv.title === 'Proforma invoice' ? t('invoice.proforma') : inv.title === 'Tax invoice' ? t('invoice.taxInvoice') : t('invoice.billOfSupply');
}

function InvoiceBody({ invoice: inv }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  return (
    <View style={styles.gap} testID="invoice">
      <AppText size="sm" color={c.textMuted}>{t('invoice.date', { date: formatDateTime(inv.issuedAt, lang) })}</AppText>
      <Card style={styles.card}>
        <Party label={t('invoice.from')} party={inv.seller} />
        <Party label={t('invoice.to')} party={inv.buyer} />
        <AppText size="sm" color={c.textMuted}>{t('invoice.booking', { ref: inv.booking.id.slice(0, 8).toUpperCase(), service: inv.booking.service })}</AppText>
      </Card>
      <Card style={styles.card}>
        {inv.lines.map((l, i) => (
          <MoneyRow key={i} label={l.qty > 1 ? `${l.description} × ${l.qty}` : l.description} value={rupees(l.amountPaise)} small />
        ))}
        <Divider />
        <MoneyRow label={t('invoice.taxable')} value={rupees(inv.taxablePaise)} />
        {inv.cgstPaise ? <MoneyRow label="CGST" value={rupees(inv.cgstPaise)} small /> : null}
        {inv.sgstPaise ? <MoneyRow label="SGST" value={rupees(inv.sgstPaise)} small /> : null}
        <MoneyRow label={t('rent.total')} value={rupees(inv.totalPaise)} strong />
        {inv.paidPaise !== undefined ? <MoneyRow label={t('invoice.paid')} value={rupees(inv.paidPaise)} accent /> : null}
        {inv.refundedPaise ? <MoneyRow label={t('booking.refund')} value={rupees(inv.refundedPaise)} /> : null}
      </Card>
      <AppText size="xs" color={c.textMuted}>{inv.note}</AppText>
    </View>
  );
}

function Party({ label, party }: { label: string; party: Invoice['seller'] }) {
  return (
    <View style={{ gap: 2 }}>
      <AppText size="xs" color={c.textMuted}>{label}</AppText>
      <AppText size="md" variant="bold">{party.name}</AppText>
      {party.address ? <AppText size="sm">{party.address}</AppText> : null}
      {party.gstin ? <AppText size="sm">{`GSTIN ${party.gstin}`}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.md },
  card: { padding: space.lg, gap: space.sm },
});
