// Create an event (wedding, puja, birthday …) to book vendors for.
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { emptyEvent, firstEventError, revalidate, validateEvent, validateField, type EventErrors } from '../../lib/events';
import { keys } from '../../lib/queryClient';
import { c } from '../../lib/theme';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { EventForm } from '../../components/EventForm';
import { Screen, ScreenHeader } from '../../components/Screen';
import { useToast } from '../../components/Toast';

export default function NewEventScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => emptyEvent());
  const [errors, setErrors] = useState<EventErrors>({});
  const toast = useToast();
  const titleRef = useRef<TextInputInstance>(null);
  const guestsRef = useRef<TextInputInstance>(null);
  const venueRef = useRef<TextInputInstance>(null);
  const create = useMutation({
    mutationFn: api.createEvent,
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: keys.events });
      toast.success(t('event.created', { name: e.title }));
      router.back();
    },
  });

  async function submit() {
    const { errors: errs, event } = validateEvent(draft);
    setErrors(errs);
    if (!event) {
      const first = firstEventError(errs);
      (first === 'title' ? titleRef : first === 'guests' ? guestsRef : first === 'venue' ? venueRef : null)?.current?.focus();
      return false;
    }
    await create.mutateAsync(event);
  }

  return (
    <Screen
      scroll
      keyboard
      footer={
        <>
          {create.error ? (
            <AppText size="sm" color={c.danger} align="center" accessibilityLiveRegion="assertive">
              {errorText(t, create.error)}
            </AppText>
          ) : null}
          <Button label={t('event.create')} onPress={submit} loadingLabel={t('event.creating')} />
        </>
      }
    >
      <ScreenHeader title={t('event.newTitle')} />
      <AppText size="md">{t('event.newBody')}</AppText>
      <EventForm
        value={draft}
        onChange={(d) => {
          setDraft(d);
          setErrors((current) => revalidate(d, current));
        }}
        onBlurField={(field) => setErrors((current) => validateField(draft, field, current))}
        errors={errors}
        refs={{ title: titleRef, guests: guestsRef, venue: venueRef }}
      />
    </Screen>
  );
}
