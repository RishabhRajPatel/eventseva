import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { vendorPayout } from '../lib/bookings';
import { c, space } from '../lib/theme';
import { Txt } from './Txt';

/**
 * What the vendor gets: the payout from EventSeva and what to collect at the event.
 * The EventSeva fee is shown plainly, in small muted text, never as a red deduction. An admin refund
 * that came out of the payout is listed as its own line (the payout already has it taken off).
 */
export function MoneyBreakdown({ booking, full }: { booking: Booking; full?: boolean }) {
  const { t } = useTranslation();
  const fee = booking.commissionPaise ?? booking.advancePaise - vendorPayout(booking);
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.line}>
        <Txt size="md">{t('money.youReceive')}</Txt>
        <Txt variant="bold" size="lg" color={c.royal} testID="payout">
          {rupees(vendorPayout(booking))}
        </Txt>
      </View>
      {booking.payoutDeductionPaise ? (
        <View testID="payout-deduction" style={{ gap: 2 }}>
          <View style={styles.line}>
            <Txt size="sm">{t('money.deduction')}</Txt>
            <Txt variant="bold" size="sm">
              −{rupees(booking.payoutDeductionPaise)}
            </Txt>
          </View>
          <Txt size="xs" color={c.textMuted}>
            {t('money.deductionNote')}
          </Txt>
        </View>
      ) : null}
      <View style={styles.line}>
        <Txt size="md">{t('money.collectAtEvent')}</Txt>
        <Txt variant="bold" size="md">
          {rupees(booking.balancePaise)}
        </Txt>
      </View>
      {full ? (
        <View style={[styles.line, styles.total]}>
          <Txt size="sm" color={c.textMuted}>
            {t('money.bookingTotal')}
          </Txt>
          <Txt size="sm" color={c.textMuted}>
            {rupees(booking.amountPaise)}
          </Txt>
        </View>
      ) : null}
      <Txt size="xs" color={c.textMuted}>
        {t('money.feeNote', { advance: rupees(booking.advancePaise), fee: rupees(fee) })}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  total: { borderTopWidth: 1, borderTopColor: c.lavender, paddingTop: space.xs, marginTop: space.xs },
});
