import { useMemo, useState } from 'react';
import { Alert, ScrollView, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatDay, SLOTS, todayIst, type Slot } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { freeDay, monthOf, shiftMonth, slotAction, slotsByDay, type DaySlots } from '../../lib/calendar';
import { errorText } from '../../lib/errors';
import { invalidateBookings, keys, useCalendar } from '../../lib/queries';
import { slotHours, slotLabel } from '../../lib/labels';
import { c, radius, space } from '../../lib/theme';
import { useIsTablet } from '../../hooks/useIsTablet';
import { useLang } from '../../hooks/useLang';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CalendarGrid } from '../../components/CalendarGrid';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { ErrorState, Loading } from '../../components/States';
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
        <Loading />
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
  const toggle = useMutation({
    mutationFn: ({ slot, block }: { slot: Slot; block: boolean }) =>
      block ? api.post('/v1/partner/calendar/block', { day, slot }) : api.delete('/v1/partner/calendar/block', { day, slot }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.calendar(month) });
    },
    onError: (e) => {
      invalidateBookings(qc);
      Alert.alert(t('errors.title'), errorText(t, e));
    },
  });

  return (
    <View style={{ gap: space.md }} testID="day-panel">
      <Txt variant="display" size="xl">
        {formatDay(day, lang, true)}
      </Txt>
      {SLOTS.map((slot) => {
        const state = slots[slot];
        const action = slotAction(slots, slot, day, today);
        const busy = toggle.isPending && toggle.variables?.slot === slot;
        let status: string = t(`calendar.state.${state.status}`);
        if (state.status === 'free' && action === 'none' && day >= today) status = t('calendar.state.overlap');
        return (
          <Card key={slot} style={styles.slotRow} testID={`slot-${slot}`}>
            <View style={{ flex: 1 }}>
              <Txt variant="bold" size="md">
                {slotLabel(t, slot)} <Txt size="sm" color={c.textMuted}>· {slotHours(t, slot)}</Txt>
              </Txt>
              <Txt size="sm" color={state.status === 'booked' ? c.royal : c.ink}>
                {status}
              </Txt>
            </View>
            {action === 'block' ? (
              <Button testID={`block-${slot}`} kind="outline" label={t('calendar.block')} loading={busy} onPress={() => toggle.mutate({ slot, block: true })} />
            ) : action === 'unblock' ? (
              <Button testID={`unblock-${slot}`} kind="secondary" label={t('calendar.unblock')} loading={busy} onPress={() => toggle.mutate({ slot, block: false })} />
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
});
