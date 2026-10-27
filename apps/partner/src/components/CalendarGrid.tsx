import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { memo } from 'react';
import { monthGrid, summarizeDay, type DaySlots, type DaySummary } from '../lib/calendar';
import { haptic } from '../lib/haptics';
import { c, DISABLED_OPACITY, radius, space } from '../lib/theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const CELL: Record<DaySummary, { bg: string; border?: string; dashed?: boolean }> = {
  free: { bg: c.mintLight },
  partial: { bg: c.mintLight, border: c.peach },
  booked: { bg: c.peach },
  blocked: { bg: c.white, border: c.ink, dashed: true },
  past: { bg: 'transparent' },
};

/** Month grid (Mon–Sun) coloured by what is booked or blocked; past days are disabled. */
export const CalendarGrid = memo(function CalendarGrid({
  month,
  slots,
  today,
  selected,
  onSelect,
  large,
}: {
  month: string;
  slots: Map<string, DaySlots>;
  today: string;
  selected: string | null;
  onSelect: (day: string) => void;
  large?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.week}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={styles.cell}>
            <Txt variant="bold" size="xs" align="center">
              {t(`calendar.weekdays.${d}`)}
            </Txt>
          </View>
        ))}
      </View>
      {monthGrid(month).map((week, i) => (
        <View key={i} style={styles.week}>
          {week.map((day, j) => {
            if (!day) return <View key={j} style={styles.cell} />;
            const daySlots = slots.get(day);
            const summary = summarizeDay(daySlots, day, today);
            const look = CELL[summary];
            const isSelected = day === selected;
            const disabled = summary === 'past';
            return (
              <View key={day} style={styles.cell}>
                <Pressable
                  testID={`day-${day}`}
                  accessibilityRole="radio"
                  accessibilityLabel={`${Number(day.slice(8))} · ${t(`calendar.summary.${summary}`)}`}
                  accessibilityHint={disabled ? t('calendar.summary.past') : undefined}
                  accessibilityState={{ disabled, selected: isSelected, checked: isSelected }}
                  disabled={disabled}
                  onPress={() => {
                    if (!isSelected) haptic.select();
                    onSelect(day);
                  }}
                  style={({ pressed }) => [
                    styles.day,
                    { minHeight: large ? 64 : 40, backgroundColor: isSelected ? c.lilac : look.bg },
                    isSelected
                      ? styles.selected
                      : look.border
                        ? { borderWidth: look.dashed ? 1.5 : 2, borderColor: look.border, borderStyle: look.dashed ? 'dashed' : 'solid' }
                        : null,
                    disabled ? { opacity: DISABLED_OPACITY } : pressed ? { opacity: 0.85 } : null,
                  ]}
                >
                  {isSelected ? (
                    <View style={styles.tick}>
                      <Icon name="check" size={9} strokeWidth={3.5} color={c.white} />
                    </View>
                  ) : null}
                  <Txt variant="bold" size={large ? 'lg' : 'md'} color={c.ink}>
                    {Number(day.slice(8))}
                  </Txt>
                  {daySlots && !disabled ? <SlotDots slots={daySlots} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <Legend />
    </View>
  );
});

/** Small marks under the date: one per taken half of the day (full day = both). */
function SlotDots({ slots }: { slots: DaySlots }) {
  const color = (s: DaySlots['day']) => (s.status === 'booked' ? c.royal : s.status === 'blocked' ? c.muted : 'transparent');
  const dayState = slots.full.status !== 'free' ? slots.full : slots.day;
  const nightState = slots.full.status !== 'free' ? slots.full : slots.night;
  return (
    <View style={styles.dots}>
      <View style={[styles.dot, { backgroundColor: color(dayState) }]} />
      <View style={[styles.dot, { backgroundColor: color(nightState) }]} />
    </View>
  );
}

function Legend() {
  const { t } = useTranslation();
  const items: Array<{ key: string; style: object }> = [
    { key: 'free', style: { backgroundColor: c.mintLight, borderWidth: 1, borderColor: c.mint } },
    { key: 'booked', style: { backgroundColor: c.peach } },
    { key: 'blocked', style: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.ink } },
    { key: 'selected', style: { backgroundColor: c.lilac, borderWidth: 2, borderColor: c.royal } },
    { key: 'past', style: { backgroundColor: c.mintLight, opacity: DISABLED_OPACITY } },
  ];
  return (
    <View style={styles.legend}>
      {items.map((i) => (
        <View key={i.key} style={styles.legendItem}>
          <View style={[styles.swatch, i.style]} />
          <Txt size="xs">{t(`calendar.legend.${i.key}`)}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  cell: { width: `${100 / 7}%`, padding: 3 },
  day: { aspectRatio: 1, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  selected: { borderWidth: 2, borderColor: c.royal },
  tick: { position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
});
