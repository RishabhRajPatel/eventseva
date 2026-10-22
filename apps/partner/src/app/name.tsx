import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

/** New users tell us their name once, right after login. */
export default function NameScreen() {
  const { t } = useTranslation();
  const { updateMe } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (name.trim().length < 2) {
      setError(t('form.short'));
      return;
    }
    setSaving(true);
    try {
      const me = await api.patch<Me>('/v1/me', { name: name.trim() });
      updateMe(me);
      router.replace('/');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title={t('name.title')} footer={<Button testID="save-name" size="lg" label={t('common.continue')} loading={saving} onPress={() => void save()} />}>
      <Txt size="md">{t('name.subtitle')}</Txt>
      <Field
        testID="name-input"
        label={t('name.label')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        autoFocus
        autoComplete="name"
        maxLength={80}
        placeholder={t('name.placeholder')}
        error={error}
        onSubmitEditing={() => void save()}
      />
    </Screen>
  );
}
