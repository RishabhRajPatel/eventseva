import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { Card, CardHeader } from './Card';
import { LinkButton } from './Button';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { Txt } from './Txt';

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

/** There is no bank-account API yet; EventSeva support collects the details. */
export function BankCard() {
  const { t } = useTranslation();
  return (
    <Card testID="bank-card">
      <CardHeader title={t('bank.title')} right={<Icon name="bank" size={20} color={c.royal} />} />
      <Notice icon="clock">{t('bank.comingSoon')}</Notice>
      <Txt size="xs" color={c.textMuted}>
        {t('bank.note')}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  hold: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.peach, paddingHorizontal: space.lg, paddingVertical: space.xs },
});
