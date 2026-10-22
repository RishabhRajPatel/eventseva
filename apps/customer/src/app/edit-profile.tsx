// Profile → Edit: change the name.
import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useMe, useSession } from '../lib/session';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Screen, ScreenHeader } from '../components/Screen';

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const session = useSession();
  const [name, setName] = useState(me.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) return setError(t('welcome.nameTooShort'));
    setBusy(true);
    try {
      session.setMe(await api.updateMe({ name: clean }));
      router.back();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  }

  return (
    <Screen keyboard scroll footer={<Button label={t('common.save')} onPress={save} loading={busy} />}>
      <ScreenHeader title={t('profile.editTitle')} />
      <TextField
        label={t('welcome.nameLabel')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        autoCapitalize="words"
        maxLength={80}
        error={error}
      />
      <AppText size="sm">{t('profile.phoneFixed', { phone: formatPhone(me.phone) })}</AppText>
    </Screen>
  );
}
