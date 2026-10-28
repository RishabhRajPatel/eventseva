// Online or cash, for an item whose vendor accepts cash. Cash bookings are confirmed by the vendor's
// yes and paid to the vendor in person; online ones need the advance in the app.
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PayMode } from '@eventseva/app-shared';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Chip } from './Form';

export function PayModePicker({ value, onChange }: { value: PayMode; onChange: (m: PayMode) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <AppText variant="bold" size="sm">{t('payMode.title')}</AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('payMode.title')}>
        <Chip label={t('payMode.online')} selected={value === 'online'} onPress={() => onChange('online')} />
        <Chip label={t('payMode.cash')} selected={value === 'cash'} onPress={() => onChange('cash')} />
      </View>
      <AppText size="xs" color={c.textMuted} testID="pay-mode-hint">{t(value === 'cash' ? 'payMode.cashHint' : 'payMode.onlineHint')}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
