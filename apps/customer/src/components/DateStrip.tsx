import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';

/** Next days as a strip of free / booked tiles (Vendor board "Pick a date"). */
export function DateStrip({
  from,
  days = 30,
  byDay,
  value,
  onChange,
}: {
  from: string;
  days?: number;
  byDay: Record<string, 'full' | 'partial'>;
  value: string | null;
  onChange: (day: string) => void;
}) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const list = Array.from({ length: days }, (_, i) => addDays(from, i));
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {list.map((day) => {
          const d = new Date(`${day}T00:00:00Z`);
          const weekday = d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
          const month = d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
          const state = byDay[day];
          const selected = value === day;
          const stateLabel = state === 'full' ? t('date.booked') : state === 'partial' ? t('date.partly') : t('date.free');
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${weekday} ${d.getUTCDate()} ${month}, ${stateLabel}`}
              onPress={() => onChange(day)}
              style={[styles.tile, !state && styles.free, state === 'partial' && styles.partial, state === 'full' && styles.full, selected && styles.selected]}
            >
              <AppText size="xs" color={selected ? c.white : c.text}>
                {weekday}
              </AppText>
              <AppText variant="bold" size={16} color={selected ? c.white : c.text} style={state === 'full' && !selected ? styles.strike : undefined}>
                {String(d.getUTCDate())}
              </AppText>
              <AppText size={10} color={selected ? c.white : c.textMuted}>
                {month}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.legend}>
        <Legend style={styles.free} label={t('date.free')} />
        <Legend style={styles.partial} label={t('date.partly')} />
        <Legend style={styles.full} label={t('date.booked')} />
        <Legend style={styles.selected} label={t('date.selected')} />
      </View>
    </View>
  );
}

function Legend({ style, label }: { style: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, style]} />
      <AppText size="xs">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { gap: space.sm },
  tile: { width: 56, minHeight: 72, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 1 },
  free: { backgroundColor: c.mintLight },
  partial: { backgroundColor: c.peach },
  full: { backgroundColor: c.white, borderWidth: 1, borderStyle: 'dashed', borderColor: c.ink },
  selected: { backgroundColor: c.royal, borderWidth: 0 },
  strike: { textDecorationLine: 'line-through' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
});
