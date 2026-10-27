import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { haptic } from '../lib/haptics';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { SelectedMark } from './Form';

type DayState = 'full' | 'partial' | undefined;

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
  const list = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);
  const labels = useMemo(() => ({ full: t('date.booked'), partial: t('date.partly'), free: t('date.free') }), [t]);
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
        {list.map((day) => (
          <DayTile key={day} day={day} locale={locale} state={byDay[day]} selected={value === day} labels={labels} onChange={onChange} />
        ))}
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

const DayTile = memo(function DayTile({
  day,
  locale,
  state,
  selected,
  labels,
  onChange,
}: {
  day: string;
  locale: string;
  state: DayState;
  selected: boolean;
  labels: { full: string; partial: string; free: string };
  onChange: (day: string) => void;
}) {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
  const month = d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
  const stateLabel = state ? labels[state] : labels.free;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${weekday} ${d.getUTCDate()} ${month}, ${stateLabel}`}
      onPress={() => {
        haptic.select();
        onChange(day);
      }}
      style={({ pressed }) => [
        styles.tile,
        !state && styles.free,
        state === 'partial' && styles.partial,
        state === 'full' && styles.full,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      {selected ? (
        <View style={styles.mark}>
          <SelectedMark size={16} />
        </View>
      ) : null}
      <AppText size="xs">{weekday}</AppText>
      <AppText variant="bold" size="lg" style={state === 'full' ? styles.strike : undefined}>
        {String(d.getUTCDate())}
      </AppText>
      <AppText size={11} color={c.textMuted}>
        {month}
      </AppText>
    </Pressable>
  );
});

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
  row: { gap: space.sm, paddingTop: space.xs },
  tile: { width: 56, minHeight: 76, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 1 },
  free: { backgroundColor: c.mintLight },
  partial: { backgroundColor: c.peach },
  full: { backgroundColor: c.white, borderWidth: 1, borderStyle: 'dashed', borderColor: c.ink },
  selected: { backgroundColor: c.selectedBg, borderWidth: 2, borderStyle: 'solid', borderColor: c.selectedBorder },
  pressed: { opacity: 0.85 },
  mark: { position: 'absolute', top: -4, right: -4 },
  strike: { textDecorationLine: 'line-through' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
});
