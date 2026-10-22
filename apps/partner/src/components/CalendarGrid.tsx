import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { monthGrid, summarizeDay, type DaySlots, type DaySummary } from '../lib/calendar';
import { c, radius, space } from '../lib/theme';
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
export function CalendarGrid({
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
                  accessibilityRole="button"
                  accessibilityLabel={`${Number(day.slice(8))} · ${t(`calendar.summary.${summary}`)}`}
                  accessibilityState={{ disabled, selected: isSelected }}
                  disabled={disabled}
                  onPress={() => onSelect(day)}
                  style={[
                    styles.day,
                    { minHeight: large ? 64 : 40, backgroundColor: isSelected ? c.royal : look.bg },
                    look.border && !isSelected ? { borderWidth: look.dashed ? 1 : 2, borderColor: look.border, borderStyle: look.dashed ? 'dashed' : 'solid' } : null,
                    disabled ? { opacity: 0.35 } : null,
                  ]}
                >
                  <Txt variant="bold" size={large ? 'lg' : 'md'} color={isSelected ? c.white : c.ink}>
                    {Number(day.slice(8))}
                  </Txt>
                  {daySlots && !disabled ? <SlotDots slots={daySlots} light={isSelected} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <Legend />
    </View>
  );
}

/** Small marks under the date: one per taken half of the day (full day = both). */
function SlotDots({ slots, light }: { slots: DaySlots; light: boolean }) {
  const color = (s: DaySlots['day']) => (s.status === 'booked' ? (light ? c.peach : c.royal) : s.status === 'blocked' ? (light ? c.white : c.muted) : 'transparent');
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
    { key: 'selected', style: { backgroundColor: c.royal } },
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
  swatch: { width: 12, height: 12, borderRadius: 4 },
});
