// Profile → Delete account. Google Play requires in-app deletion; typing DELETE guards against a mis-tap.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Screen, ScreenHeader } from '../components/Screen';

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === 'DELETE';

  async function remove() {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      Alert.alert(t('deleteAccount.doneTitle'), t('deleteAccount.doneBody'));
      await session.signOut();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  }

  return (
    <Screen
      keyboard
      scroll
      footer={<Button label={t('deleteAccount.button')} variant="danger" onPress={remove} disabled={!confirmed} loading={busy} />}
    >
      <ScreenHeader title={t('deleteAccount.title')} />
      <AppText variant="bold" size="md">
        {t('deleteAccount.warningTitle')}
      </AppText>
      <AppText size="sm">{t('deleteAccount.warningBody')}</AppText>
      <View style={{ gap: 4 }}>
        <AppText variant="bold" size="sm">
          {t('deleteAccount.removedTitle')}
        </AppText>
        <AppText size="sm">{t('deleteAccount.removed')}</AppText>
        <AppText variant="bold" size="sm">
          {t('deleteAccount.keptTitle')}
        </AppText>
        <AppText size="sm">{t('deleteAccount.kept')}</AppText>
      </View>
      <TextField
        label={t('deleteAccount.typeLabel')}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        placeholder="DELETE"
        error={error}
      />
    </Screen>
  );
}
