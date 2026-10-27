import { Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, invoiceText, rupees, type Invoice } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { STALE } from '../../lib/queries';
import { c, space } from '../../lib/theme';
import { useLang } from '../../hooks/useLang';
import { Button } from '../../components/Button';
import { Card, Row } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** The invoice issued in the vendor's name to the customer, or EventSeva's commission invoice to the vendor. */
export default function InvoiceScreen() {
  const { t } = useTranslation();
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const commission = kind === 'commission';
  const invoice = useQuery({
    queryKey: ['invoice', id, commission ? 'commission' : 'customer'],
    queryFn: () => api.get<Invoice>(`/v1/partner/bookings/${id}/${commission ? 'commission-invoice' : 'invoice'}`),
    staleTime: STALE.slow,
  });
  return (
    <Screen
      back
      title={t(commission ? 'invoice.commissionTitle' : 'invoice.title')}
      footer={invoice.data ? <Button testID="share-invoice" icon="send" label={t('invoice.share')} onPress={() => void Share.share({ message: invoiceText(invoice.data!) })} /> : null}
    >
      <QueryView query={invoice}>{(inv) => <InvoiceBody invoice={inv} />}</QueryView>
    </Screen>
  );
}

export function InvoiceBody({ invoice: inv }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const lang = useLang();
  const money = (label: string, paise: number, bold = false) => (
    <View style={styles.line}>
      <Txt size="md" variant={bold ? 'bold' : undefined} style={{ flex: 1 }}>{label}</Txt>
      <Txt size="md" variant={bold ? 'bold' : undefined}>{rupees(paise)}</Txt>
    </View>
  );
  return (
    <View style={{ gap: space.lg }} testID="invoice">
      <Card style={{ gap: space.xs }}>
        <Txt variant="display" size="xl">{inv.title === 'Tax invoice' ? t('invoice.taxInvoice') : t('invoice.billOfSupply')}</Txt>
        <Txt size="sm" color={c.textMuted}>{t('invoice.number', { number: inv.number, date: formatDateTime(inv.issuedAt, lang) })}</Txt>
      </Card>
      <Card style={{ gap: space.sm }}>
        <Party label={t('invoice.from')} party={inv.seller} />
        <Party label={t('invoice.to')} party={inv.buyer} />
        <Txt size="sm" color={c.textMuted}>{t('invoice.booking', { ref: inv.booking.id.slice(0, 8).toUpperCase(), service: inv.booking.service })}</Txt>
      </Card>
      <Card>
        {inv.lines.map((l, i) => (
          <Row key={i} first={i === 0}>
            <Txt size="md" style={{ flex: 1 }}>{l.qty > 1 ? `${l.description} × ${l.qty}` : l.description}</Txt>
            <Txt size="md">{rupees(l.amountPaise)}</Txt>
          </Row>
        ))}
        <View style={{ gap: space.xs, paddingTop: space.md }}>
          {money(t('invoice.taxable'), inv.taxablePaise)}
          {inv.cgstPaise ? money(t('invoice.cgst'), inv.cgstPaise) : null}
          {inv.sgstPaise ? money(t('invoice.sgst'), inv.sgstPaise) : null}
          {money(t('invoice.total'), inv.totalPaise, true)}
          {inv.paidPaise !== undefined ? money(t('invoice.paid'), inv.paidPaise) : null}
          {inv.refundedPaise ? money(t('invoice.refunded'), inv.refundedPaise) : null}
        </View>
      </Card>
      <Txt size="xs" color={c.textMuted}>{inv.note}</Txt>
    </View>
  );
}

function Party({ label, party }: { label: string; party: Invoice['seller'] }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 2 }}>
      <Txt size="xs" color={c.textMuted}>{label}</Txt>
      <Txt size="md" variant="bold">{party.name}</Txt>
      {party.address ? <Txt size="sm">{party.address}</Txt> : null}
      {party.gstin ? <Txt size="sm">{t('invoice.gstin', { gstin: party.gstin })}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
