import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { IconButton } from './Button';
import { Txt } from './Txt';

export function monthName(month: string, lang: 'en' | 'hi', withYear = true): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'UTC',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function MonthSwitcher({ month, onPrev, onNext, canPrev = true, canNext = true }: { month: string; onPrev: () => void; onNext: () => void; canPrev?: boolean; canNext?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <View style={styles.row}>
      <View style={{ opacity: canPrev ? 1 : 0.35 }}>
        <IconButton icon="back" label={t('calendar.prevMonth')} onPress={canPrev ? onPrev : undefined} />
      </View>
      <Txt variant="bold" size="md" testID="month-label" style={styles.label} align="center">
        {monthName(month, lang)}
      </Txt>
      <View style={{ opacity: canNext ? 1 : 0.35 }}>
        <IconButton icon="next" label={t('calendar.nextMonth')} onPress={canNext ? onNext : undefined} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { minWidth: 110 },
});
