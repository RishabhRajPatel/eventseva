// Add or change the venue (address, landmark, pin) of an event after booking. Vendors with a
// confirmed booking are told, and see the new distance and directions.
import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { errorText } from '../../../lib/errors';
import { keys } from '../../../lib/queryClient';
import { c } from '../../../lib/theme';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Screen, ScreenHeader } from '../../../components/Screen';
import { CardsSkeleton } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/States';
import { useToast } from '../../../components/Toast';
import { VenuePicker, type Venue } from '../../../components/VenuePicker';

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const event = useQuery({ queryKey: keys.event(id), queryFn: () => api.event(id) });
  const [venue, setVenue] = useState<Venue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (event.data && !venue) {
      setVenue({ address: event.data.venueAddress ?? '', landmark: event.data.venueLandmark ?? '', pin: event.data.venueLocation });
    }
  }, [event.data, venue]);

  const save = useMutation({
    mutationFn: (v: Venue) =>
      api.updateEvent(id, {
        venueAddress: v.address.trim() || null,
        venueLandmark: v.landmark.trim().length >= 2 ? v.landmark.trim() : null,
        venueLat: v.pin?.lat ?? null,
        venueLng: v.pin?.lng ?? null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.allBookings });
      toast.success(t('venue.saved'));
      router.back();
    },
  });

  async function submit() {
    if (!venue) return false;
    const address = venue.address.trim();
    if (address && address.length < 5) {
      setError(t('event.errors.venueShort'));
      return false;
    }
    setError(null);
    await save.mutateAsync(venue);
  }

  if (event.error) {
    return (
      <Screen>
        <ScreenHeader title={t('venue.editTitle')} />
        <ErrorState error={event.error} onRetry={() => event.refetch()} />
      </Screen>
    );
  }
  return (
    <Screen
      scroll
      keyboard
      footer={
        <>
          {save.error ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {errorText(t, save.error)}
            </AppText>
          ) : null}
          <Button testID="venue-save" label={t('venue.save')} loadingLabel={t('venue.saving')} disabled={!venue} onPress={submit} />
        </>
      }
    >
      <ScreenHeader title={t('venue.editTitle')} subtitle={event.data?.title} />
      <AppText size="md">{t('venue.editBody')}</AppText>
      {venue ? <VenuePicker value={venue} onChange={setVenue} addressError={error} /> : <CardsSkeleton count={2} height={90} />}
    </Screen>
  );
}
