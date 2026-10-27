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
import { useToast } from '../components/Toast';

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const session = useSession();
  const [name, setName] = useState(me.name ?? '');
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      setError(t('welcome.nameTooShort'));
      return false;
    }
    try {
      session.setMe(await api.updateMe({ name: clean }));
    } catch (e) {
      setError(errorText(t, e));
      throw e;
    }
    toast.success(t('profile.nameSaved'));
    router.back();
  }

  return (
    <Screen keyboard scroll footer={<Button label={t('common.save')} onPress={save} loadingLabel={t('common.saving')} />}>
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
