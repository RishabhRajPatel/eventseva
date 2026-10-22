import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { Card, CardHeader } from './Card';
import { LinkButton } from './Button';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { Txt } from './Txt';
import { Pill } from './Chip';
import { useBankAccount } from '../lib/queries';
import { maskAccount } from '../lib/bank';

/** Persistent on the tabs while the team has put the profile on hold. */
export function OnHoldBanner() {
  const { t } = useTranslation();
  return (
    <View style={styles.hold} testID="on-hold-banner" accessibilityRole="alert">
      <Icon name="eye" size={18} color={c.ink} />
      <Txt size="sm" variant="bold" style={{ flex: 1 }}>
        {t('onHold.banner')}
      </Txt>
      <LinkButton label={t('onHold.contact')} onPress={() => router.push('/help')} />
    </View>
  );
}

const BANK_TONE = { pending: 'warning', verified: 'success', rejected: 'danger' } as const;

/** Where payouts go: masked account, its check status, and a way to add or change it. */
export function BankCard() {
  const { t } = useTranslation();
  const bank = useBankAccount();
  const account = bank.data;
  return (
    <Card testID="bank-card">
      <CardHeader
        title={t('bank.title')}
        right={<LinkButton testID="edit-bank" label={account ? t('common.change') : t('bank.add')} onPress={() => router.push('/bank')} />}
      />
      {account ? (
        <View style={{ gap: space.xs }}>
          <View style={styles.bankRow}>
            <Icon name="bank" size={20} color={c.royal} />
            <Txt variant="bold" size="md" style={{ flex: 1 }}>
              {`${maskAccount(account.accountLast4)} · ${account.ifsc}`}
            </Txt>
            <Pill tone={BANK_TONE[account.status]} label={t(`bank.status.${account.status}`)} />
          </View>
          <Txt size="sm" color={c.textMuted}>
            {account.holderName}
            {account.upiId ? ` · ${account.upiId}` : ''}
          </Txt>
          {account.status === 'rejected' && account.rejectReason ? <Notice tone="warning">{account.rejectReason}</Notice> : null}
        </View>
      ) : (
        <Notice icon="alert" tone="warning">
          {t('bank.missing')}
        </Notice>
      )}
      <Txt size="xs" color={c.textMuted}>
        {t('bank.note')}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hold: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.peach, paddingHorizontal: space.lg, paddingVertical: space.xs },
});
