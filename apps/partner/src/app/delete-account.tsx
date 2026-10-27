import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

/** Google Play requires in-app account deletion. Typing DELETE guards against a mis-tap. */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim().toUpperCase() === 'DELETE';
  const remove = useMutation({
    mutationFn: () => api.delete('/v1/me', { confirm: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('deleteAccount.doneBody'));
      await signOut();
    },
    onError: () => undefined,
  });

  return (
    <Screen back title={t('deleteAccount.title')} testID="delete-account">
      <Notice icon="alert" tone="warning" title={t('deleteAccount.warningTitle')}>
        {t('deleteAccount.warningBody')}
      </Notice>
      <Card style={{ gap: space.sm }}>
        <Txt variant="bold" size="md">
          {t('deleteAccount.removedTitle')}
        </Txt>
        {(['removed1', 'removed2', 'removed3'] as const).map((k) => (
          <Txt key={k} size="sm">{`• ${t(`deleteAccount.${k}`)}`}</Txt>
        ))}
        <Txt variant="bold" size="md" style={{ marginTop: space.sm }}>
          {t('deleteAccount.keptTitle')}
        </Txt>
        <Txt size="sm" color={c.textMuted}>
          {t('deleteAccount.kept')}
        </Txt>
      </Card>
      <View style={{ gap: space.md }}>
        <Field label={t('deleteAccount.typeLabel')} value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder="DELETE" testID="confirm-delete" />
        <Button
          testID="delete-confirm"
          kind="danger"
          label={t('deleteAccount.button')}
          disabled={!confirmed}
          loading={remove.isPending}
          onPress={() => {
            if (confirmed && !remove.isPending) remove.mutate();
          }}
        />
        {remove.isError ? (
          <Notice icon="alert" tone="danger" testID="delete-error">
            {errorText(t, remove.error)}
          </Notice>
        ) : null}
      </View>
    </Screen>
  );
}
