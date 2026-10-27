// Booking page: how far the vendor travels, when they should arrive, and (on the event day) whether
// they are on the way or have reached. Keeps both sides on the same page without a phone call.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatClock, formatDistance, formatMinutes, formatTimeIst, minutesUntil, type Booking } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { useNow } from '../hooks/useNow';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

const ACTIVE = ['requested', 'accepted', 'confirmed'];

/** "Raj DJ is on the way · reaching in about 18 min (5:40 pm)", updated every minute. */
export function ProgressBanner({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const now = useNow();
  if (!b.progress || b.status !== 'confirmed') return null;
  const name = b.vendor.businessName;
  if (b.progress.status === 'reached') {
    return (
      <View style={[styles.banner, styles.reached]} testID="progress-reached" accessibilityLiveRegion="polite">
        <Icon name="checkCircle" size={22} color={c.successText} />
        <View style={styles.flex}>
          <AppText variant="bold" size="lg" color={c.successText}>
            {t('progress.reached', { name })}
          </AppText>
          <AppText size="sm" color={c.successText}>
            {t('progress.reachedAt', { clock: formatTimeIst(b.progress.at) })}
          </AppText>
        </View>
      </View>
    );
  }
  const left = b.progress.etaAt ? minutesUntil(b.progress.etaAt, now) : null;
  return (
    <View style={[styles.banner, styles.onTheWay]} testID="progress-on-the-way" accessibilityLiveRegion="polite">
      <Icon name="car" size={22} color={c.royal} />
      <View style={styles.flex}>
        <AppText variant="bold" size="lg">
          {t('progress.onTheWay', { name })}
        </AppText>
        <AppText size="md">
          {left === null
            ? t('progress.soon')
            : left === 0
              ? t('progress.etaPassed')
              : t('progress.eta', { time: formatMinutes(left, lang), clock: formatTimeIst(b.progress.etaAt!) })}
        </AppText>
      </View>
    </View>
  );
}

/** Distance, travel time, the vendor's usual range and the arrival time; or a nudge to pin the venue. */
export function TripCard({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const active = ACTIVE.includes(b.status);
  if (!active && !b.travel) return null;
  const editVenue = () => router.push({ pathname: '/event/[id]/venue', params: { id: b.event.id } });
  return (
    <View style={styles.card} testID="trip-card">
      <AppText variant="bold" size="md">
        {t('trip.title')}
      </AppText>
      {b.travel ? (
        <>
          <View style={styles.row}>
            <Icon name="pin" size={18} color={c.royal} />
            <AppText size="md" style={styles.flex}>
              {t('trip.distance', { km: formatDistance(b.travel.roadKm, lang) })} · {t('trip.time', { time: formatMinutes(b.travel.minutes, lang) })}
            </AppText>
          </View>
          {b.travel.outsideServiceArea && b.travel.serviceRadiusKm ? (
            <View style={[styles.row, styles.warn]} testID="trip-outside">
              <Icon name="alert" size={18} color={c.warningText} />
              <AppText size="sm" color={c.warningText} style={styles.flex}>
                {t('trip.outside', { radius: formatDistance(b.travel.serviceRadiusKm, lang) })}
              </AppText>
            </View>
          ) : null}
        </>
      ) : !b.event.venueLocation ? (
        <AppText size="sm">{t('trip.noPin')}</AppText>
      ) : null}
      {b.arriveBy ? (
        <View style={styles.row}>
          <Icon name="clock" size={18} color={c.royal} />
          <AppText size="md" style={styles.flex}>
            {t('trip.arriveBy', { time: formatClock(b.arriveBy) })}
          </AppText>
        </View>
      ) : null}
      {active ? (
        <Button
          testID="edit-venue"
          label={b.event.venueLocation ? t('venue.change') : t('venue.add')}
          icon={b.event.venueLocation ? 'pin' : 'locate'}
          variant={b.event.venueLocation ? 'ghost' : 'secondary'}
          size="md"
          onPress={editVenue}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  warn: { backgroundColor: c.peach, borderRadius: radius.md, padding: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg },
  onTheWay: { backgroundColor: c.lavender },
  reached: { backgroundColor: c.mint },
});
