// Create an event (wedding, puja, birthday …) to book vendors for.
import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { emptyEvent, validateEvent, type EventErrors } from '../../lib/events';
import { keys } from '../../lib/queryClient';
import { c } from '../../lib/theme';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { EventForm } from '../../components/EventForm';
import { Screen, ScreenHeader } from '../../components/Screen';

export default function NewEventScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => emptyEvent());
  const [errors, setErrors] = useState<EventErrors>({});
  const create = useMutation({
    mutationFn: api.createEvent,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.events });
      router.back();
    },
  });

  function submit() {
    const { errors: errs, event } = validateEvent(draft);
    setErrors(errs);
    if (event) create.mutate(event);
  }

  return (
    <Screen
      scroll
      keyboard
      footer={
        <>
          {create.error ? (
            <AppText size="sm" color={c.danger} align="center">
              {errorText(t, create.error)}
            </AppText>
          ) : null}
          <Button label={t('event.create')} onPress={submit} loading={create.isPending} />
        </>
      }
    >
      <ScreenHeader title={t('event.newTitle')} />
      <AppText size="md">{t('event.newBody')}</AppText>
      <EventForm value={draft} onChange={setDraft} errors={errors} />
    </Screen>
  );
}
