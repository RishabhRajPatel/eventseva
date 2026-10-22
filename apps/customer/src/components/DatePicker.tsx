import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { todayIst } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { IconButton } from './Button';

const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (day: string) => day.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Days of a month laid out Monday-first, with nulls for the blank cells before the 1st. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${pad(d)}`);
  return cells;
}

/**
 * Month calendar. `busy` marks days the vendor is fully booked (struck through, as on the Vendor
 * board) or partly booked (one slot left).
 */
export function DatePicker({
  value,
  onChange,
  minDay = todayIst(),
  busy,
  onMonthChange,
}: {
  value: string | null;
  onChange: (day: string) => void;
  minDay?: string;
  busy?: Record<string, 'full' | 'partial'>;
  onMonthChange?: (month: string) => void;
}) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [month, setMonth] = useState(monthOf(value ?? minDay));
  const cells = useMemo(() => monthGrid(month), [month]);
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const [y, m] = month.split('-').map(Number);
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' }),
  );
  const go = (by: number) => {
    const next = shiftMonth(month, by);
    setMonth(next);
    onMonthChange?.(next);
  };
  const canGoBack = month > monthOf(minDay);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        {canGoBack ? <IconButton icon="back" label={t('date.prevMonth')} onPress={() => go(-1)} tone="lavender" /> : <View style={styles.spacer} />}
        <AppText variant="bold" size="lg" accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </AppText>
        <IconButton icon="forward" label={t('date.nextMonth')} onPress={() => go(1)} tone="lavender" />
      </View>
      <View style={styles.grid}>
        {weekdays.map((w, i) => (
          <View key={`w${i}`} style={styles.cell}>
            <AppText size="xs" color={c.textMuted}>
              {w}
            </AppText>
          </View>
        ))}
        {cells.map((day, i) => {
          if (!day) return <View key={`b${i}`} style={styles.cell} />;
          const past = day < minDay;
          const state = busy?.[day];
          const selected = day === value;
          const label = `${day}${state === 'full' ? `, ${t('date.booked')}` : state === 'partial' ? `, ${t('date.partly')}` : ''}`;
          return (
            <View key={day} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected, disabled: past }}
                disabled={past}
                onPress={() => onChange(day)}
                style={[
                  styles.day,
                  !past && !state && styles.free,
                  state === 'partial' && styles.partial,
                  state === 'full' && styles.full,
                  selected && styles.selected,
                  past && styles.past,
                ]}
              >
                <AppText
                  variant="bold"
                  size="md"
                  color={selected ? c.white : c.text}
                  style={state === 'full' && !selected ? styles.strike : undefined}
                >
                  {String(Number(day.slice(8)))}
                </AppText>
              </Pressable>
            </View>
          );
        })}
      </View>
      {busy ? (
        <View style={styles.legend}>
          <Legend swatch={styles.free} label={t('date.free')} />
          <Legend swatch={styles.partial} label={t('date.partly')} />
          <Legend swatch={styles.full} label={t('date.booked')} />
        </View>
      ) : null}
    </View>
  );
}

function Legend({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, swatch]} />
      <AppText size="xs">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.sm, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spacer: { width: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 50, padding: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: '100%', height: '100%', minHeight: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  free: { backgroundColor: c.mintLight },
  partial: { backgroundColor: c.peach },
  full: { backgroundColor: c.white, borderWidth: 1, borderStyle: 'dashed', borderColor: c.ink },
  selected: { backgroundColor: c.royal, borderWidth: 0 },
  past: { opacity: 0.35 },
  strike: { textDecorationLine: 'line-through' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
});
