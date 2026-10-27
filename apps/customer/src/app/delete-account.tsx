// Profile → Delete account. Google Play requires in-app deletion; typing DELETE guards against a mis-tap.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Notice } from '../components/Bits';
import { Screen, ScreenHeader } from '../components/Screen';
import { useToast } from '../components/Toast';
import { c, space } from '../lib/theme';

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [typed, setTyped] = useState('');
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === 'DELETE';

  /** Typing DELETE is the confirmation (UX.md §4); the button guards against a double tap. */
  async function remove() {
    if (!confirmed) {
      setError(t('deleteAccount.typeFirst'));
      return false;
    }
    setError(null);
    try {
      await api.deleteAccount();
    } catch (e) {
      setError(errorText(t, e));
      throw e;
    }
    toast.success(t('deleteAccount.doneBody'));
    await session.signOut();
  }

  return (
    <Screen
      keyboard
      scroll
      footer={<Button label={t('deleteAccount.button')} variant="danger" onPress={remove} loadingLabel={t('deleteAccount.busy')} />}
    >
      <ScreenHeader title={t('deleteAccount.title')} />
      <Notice icon="alert" tone="danger">
        <AppText variant="bold" size="md" color={c.danger}>
          {t('deleteAccount.warningTitle')}
        </AppText>
        <AppText size="sm">{t('deleteAccount.warningBody')}</AppText>
      </Notice>
      <View style={styles.gap}>
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
        onChangeText={(v) => {
          setTyped(v);
          setError(null);
        }}
        autoCapitalize="characters"
        placeholder="DELETE"
        error={error}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { gap: space.xs } });
