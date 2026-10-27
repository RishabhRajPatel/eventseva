import { useMemo, useState } from 'react';
import { ScrollView, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatDay, SLOTS, todayIst, type CalendarEntry, type Slot } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { freeDay, monthOf, shiftMonth, slotAction, slotsByDay, type DaySlots } from '../../lib/calendar';
import { errorText } from '../../lib/errors';
import { invalidateBookings, keys, useCalendar } from '../../lib/queries';
import { slotHours, slotLabel } from '../../lib/labels';
import { toast } from '../../lib/toast';
import { c, DISABLED_OPACITY, radius, space } from '../../lib/theme';
import { useIsTablet } from '../../hooks/useIsTablet';
import { useLang } from '../../hooks/useLang';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { TONES } from '../../components/Chip';
import { Notice } from '../../components/Notice';
import { CalendarGrid } from '../../components/CalendarGrid';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { ErrorState } from '../../components/States';
import { Skeleton } from '../../components/Skeleton';
import { Txt } from '../../components/Txt';

/** Month view of bookings and blocked dates (VendorCalendar board). */
export default function Calendar() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tablet = useIsTablet();
  const today = todayIst();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [selected, setSelected] = useState<string | null>(today);
  const calendar = useCalendar(month);
  const slots = useMemo(() => slotsByDay(calendar.data ?? []), [calendar.data]);

  const changeMonth = (by: number) => {
    const next = shiftMonth(month, by);
    setMonth(next);
    setSelected(next === thisMonth ? today : null);
  };

  const grid = (
    <Card style={styles.gridCard}>
      {calendar.isError && !calendar.data ? (
        <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : calendar.isPending ? (
        <Skeleton kind="grid" count={35} columns={7} />
      ) : (
        <CalendarGrid month={month} slots={slots} today={today} selected={selected} onSelect={setSelected} large={tablet} />
      )}
    </Card>
  );
  const panel = selected ? <DayPanel day={selected} slots={slots.get(selected) ?? freeDay()} today={today} month={month} /> : <Txt size="sm">{t('calendar.pickDay')}</Txt>;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID="calendar">
      <View style={styles.head}>
        <Txt variant="display" size="display" accessibilityRole="header">
          {t('calendar.title')}
        </Txt>
        <MonthSwitcher month={month} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} canPrev={month > thisMonth} canNext={month < shiftMonth(thisMonth, 18)} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, tablet ? styles.row : null]}
        refreshControl={<RefreshControl refreshing={calendar.isRefetching} onRefresh={() => void calendar.refetch()} colors={[c.royal]} />}
      >
        <View style={tablet ? { flex: 1.3 } : null}>{grid}</View>
        <View style={[{ gap: space.md }, tablet ? { flex: 1 } : null]}>
          {panel}
          <Txt size="sm" style={{ lineHeight: 19 }}>
            {t('calendar.blockNote')}
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}

function DayPanel({ day, slots, today, month }: { day: string; slots: DaySlots; today: string; month: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const past = day < today;
  const dayLabel = formatDay(day, lang, true);

  const toggle = useMutation({
    mutationFn: ({ slot, block }: { slot: Slot; block: boolean; undo?: boolean }) =>
      block ? api.post('/v1/partner/calendar/block', { day, slot }) : api.delete('/v1/partner/calendar/block', { day, slot }),
    // Show the change at once; the refetch after confirms it.
    onMutate: ({ slot, block }) => {
      const key = keys.calendar(month);
      const before = qc.getQueryData<CalendarEntry[]>(key);
      qc.setQueryData<CalendarEntry[]>(key, (old = []) =>
        block ? [...old, { day, slot, status: 'blocked', bookingId: null }] : old.filter((e) => !(e.day === day && e.slot === slot && e.status === 'blocked')),
      );
      return { before };
    },
    onSuccess: (_r, { slot, block, undo }) => {
      if (undo) return;
      const what = `${dayLabel} · ${slotLabel(t, slot)}`;
      toast.success(t(block ? 'calendar.blocked' : 'calendar.unblocked', { what }), {
        action: { label: t('common.undo'), onPress: () => toggle.mutate({ slot, block: !block, undo: true }) },
      });
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.calendar(month), ctx.before);
      invalidateBookings(qc);
      toast.error(errorText(t, e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.calendar(month) });
    },
  });

  return (
    <View style={{ gap: space.md }} testID="day-panel">
      <Txt variant="display" size="xl">
        {dayLabel}
      </Txt>
      {past ? <Notice icon="clock">{t('calendar.pastNote')}</Notice> : null}
      {SLOTS.map((slot) => {
        const state = slots[slot];
        const action = slotAction(slots, slot, day, today);
        const busy = toggle.isPending && toggle.variables?.slot === slot;
        // Say why a slot can't be blocked, not only that it can't.
        let status: string = t(`calendar.state.${state.status}`);
        if (state.status === 'free' && action === 'none') status = past ? t('calendar.summary.past') : t('calendar.state.overlap');
        const tone = state.status === 'booked' ? TONES.info : state.status === 'blocked' ? TONES.neutral : action === 'none' ? null : TONES.success;
        return (
          <Card key={slot} style={[styles.slotRow, action === 'none' && state.status === 'free' ? { opacity: DISABLED_OPACITY + 0.2 } : null]} testID={`slot-${slot}`}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Txt variant="bold" size="md">
                {slotLabel(t, slot)} <Txt size="sm" color={c.textMuted}>· {slotHours(t, slot)}</Txt>
              </Txt>
              {tone ? (
                <View style={[styles.status, { backgroundColor: tone.bg }]}>
                  <Txt size="sm" variant="bold" color={tone.fg} testID={`slot-status-${slot}`}>
                    {status}
                  </Txt>
                </View>
              ) : (
                <Txt size="sm" testID={`slot-status-${slot}`}>
                  {status}
                </Txt>
              )}
            </View>
            {action === 'block' ? (
              <Button testID={`block-${slot}`} kind="outline" icon="lock" label={t('calendar.block')} loading={busy} disabled={toggle.isPending && !busy} onPress={() => toggle.mutate({ slot, block: true })} />
            ) : action === 'unblock' ? (
              <Button testID={`unblock-${slot}`} kind="secondary" label={t('calendar.unblock')} loading={busy} disabled={toggle.isPending && !busy} onPress={() => toggle.mutate({ slot, block: false })} />
            ) : action === 'open' && state.status === 'booked' ? (
              <Button testID={`open-${slot}`} label={t('common.view')} onPress={() => router.push(`/booking/${state.bookingId}`)} />
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.lg, gap: space.sm, flexWrap: 'wrap' },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxxl, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  gridCard: { borderRadius: radius.lg, padding: space.lg },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  status: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
});
