import { StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { Txt } from './Txt';

/**
 * "Cash also accepted": customers may then choose to pay the whole booking to the vendor in person.
 * The commission on such bookings is owed to EventSeva and comes off later online payouts.
 */
export function CashToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bold" size="sm">{t('cash.allowLabel')}</Txt>
        <Txt size="xs" color={c.textMuted}>{t('cash.allowHint')}</Txt>
      </View>
      <Switch
        testID="cash-allowed"
        accessibilityLabel={t('cash.allowLabel')}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: c.outline }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
