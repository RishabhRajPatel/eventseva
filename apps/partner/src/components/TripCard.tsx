// Partner booking page: how far the venue is, directions once paid, when to arrive, and the
// event-day buttons that keep the customer informed ("On the way", "Reached").
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays, formatClock, formatDistance, formatMinutes, formatTimeIst, isSafeExternalUrl, todayIst, type Booking } from '@eventseva/app-shared';
import { openLink } from '../lib/links';
import { c, space } from '../lib/theme';
import { useBookingActions } from '../hooks/useBookingActions';
import { useLang } from '../hooks/useLang';
import { ActionSheet } from './ActionSheet';
import { Button } from './Button';
import { Card, CardHeader } from './Card';
import { Pill } from './Chip';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { Txt } from './Txt';

/** ETA choices: our estimate first (if any), then common ones. */
export function etaChoices(estimate: number | null | undefined): number[] {
  const base = [15, 30, 45, 60, 90];
  return estimate ? [estimate, ...base.filter((m) => m !== estimate)] : base;
}

/** "On the way" / "Reached" are offered on the event day, or the evening before. */
export const eventDayOpen = (b: Booking, today = todayIst()) => b.status === 'confirmed' && (b.day === today || b.day === addDays(today, 1));

export function TripCard({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { progress } = useBookingActions(b.id);
  const [askEta, setAskEta] = useState(false);
  const active = ['requested', 'accepted', 'confirmed'].includes(b.status);
  if (!active && !b.travel) return null;
  const directions = isSafeExternalUrl(b.directionsUrl) ? b.directionsUrl : null;
  const dayOpen = eventDayOpen(b);
  const p = b.progress;

  return (
    <Card style={{ gap: space.md }} testID="trip-card">
      <CardHeader title={t('trip.title')} />
      {b.travel ? (
        <View style={styles.row}>
          <Icon name="navigate" size={18} color={c.royal} />
          <Txt size="md" style={{ flex: 1 }}>
            {t('trip.fromYou', { km: formatDistance(b.travel.roadKm, lang), time: formatMinutes(b.travel.minutes, lang) })}
          </Txt>
          {b.travel.outsideServiceArea ? <Pill testID="outside-range" label={t('trip.outsideRange')} tone="warning" /> : null}
        </View>
      ) : (
        <Txt size="sm" color={c.textMuted}>
          {t('trip.unknown')}
        </Txt>
      )}
      {b.arriveBy ? (
        <View style={styles.row}>
          <Icon name="clock" size={18} color={c.royal} />
          <Txt size="md" variant="bold" style={{ flex: 1 }}>
            {t('trip.arriveBy', { time: formatClock(b.arriveBy) })}
          </Txt>
        </View>
      ) : null}
      {b.event.venueLandmark ? (
        <View style={styles.row}>
          <Icon name="other" size={18} color={c.royal} />
          <Txt size="md" style={{ flex: 1 }}>
            {t('trip.landmark', { landmark: b.event.venueLandmark })}
          </Txt>
        </View>
      ) : null}
      {directions ? (
        <Button testID="directions" kind="secondary" icon="navigate" label={t('trip.directions')} onPress={() => void openLink(directions)} />
      ) : b.status !== 'confirmed' && active ? (
        <Txt size="xs" color={c.textMuted}>
          {t('trip.venueAfterPayment')}
        </Txt>
      ) : null}

      {dayOpen ? (
        <View style={styles.day} testID="event-day">
          <Txt variant="bold" size="md">
            {t('trip.eventDay')}
          </Txt>
          {p?.status === 'reached' ? (
            <Notice icon="check" tone="success">
              {t('trip.reachedAt', { time: formatTimeIst(p.at) })}
            </Notice>
          ) : (
            <>
              {p?.status === 'on_the_way' ? (
                <Notice icon="clock" tone="info">
                  {p.etaAt ? t('trip.onTheWayUntil', { time: formatTimeIst(p.etaAt) }) : t('trip.onTheWayShared')}
                </Notice>
              ) : null}
              <View style={styles.buttons}>
                <View style={{ flex: 1 }}>
                  <Button
                    testID="on-the-way"
                    kind={p ? 'secondary' : 'primary'}
                    icon="navigate"
                    label={p ? t('trip.updateEta') : t('trip.onTheWay')}
                    disabled={progress.isPending}
                    onPress={() => setAskEta(true)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    testID="reached"
                    kind={p ? 'primary' : 'secondary'}
                    icon="check"
                    label={t('trip.reached')}
                    loading={progress.isPending && progress.variables?.status === 'reached'}
                    onPress={() => progress.mutateAsync({ status: 'reached' })}
                  />
                </View>
              </View>
            </>
          )}
        </View>
      ) : null}

      <ActionSheet
        visible={askEta}
        title={t('trip.etaTitle')}
        message={t('trip.etaBody')}
        onClose={() => setAskEta(false)}
        actions={etaChoices(b.travel?.minutes).map((m, i) => ({
          label: i === 0 && b.travel?.minutes === m ? t('trip.etaEstimate', { time: formatMinutes(m, lang) }) : formatMinutes(m, lang),
          testID: `eta-${m}`,
          icon: 'clock' as const,
          onPress: () => {
            setAskEta(false);
            progress.mutate({ status: 'on_the_way', etaMinutes: m });
          },
        }))}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  day: { gap: space.sm, borderTopWidth: 1, borderTopColor: c.lavender, paddingTop: space.md },
  buttons: { flexDirection: 'row', gap: space.sm },
});
