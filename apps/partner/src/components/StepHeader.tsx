import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { Txt } from './Txt';

/** "Step 1 / 3 · Business info" with a three-part progress bar (onboarding boards). */
export function StepHeader({ step, label }: { step: 1 | 2 | 3; label: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.row}>
        <Txt variant="bold" size="sm">
          {t('onboarding.step', { step, total: 3 })}
        </Txt>
        <Txt variant="bold" size="sm" color={c.royal}>
          {label}
        </Txt>
      </View>
      <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: step }}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.part, { backgroundColor: n <= step ? c.royal : c.lilac }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  bar: { flexDirection: 'row', gap: 6 },
  part: { flex: 1, height: 6, borderRadius: 3 },
});
