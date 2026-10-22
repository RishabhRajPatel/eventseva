import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { invalidateVendor } from '../lib/queries';

/** Save / delete for a service or package; goes back to the list when done. */
export function useCatalogMutations(kind: 'services' | 'packages', id: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const done = () => {
    invalidateVendor(qc);
    router.back();
  };
  const onError = (e: unknown) => Alert.alert(t('errors.title'), errorText(t, e));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (id ? api.patch(`/v1/partner/${kind}/${id}`, body) : api.post(`/v1/partner/${kind}`, body)),
    onSuccess: done,
    onError,
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/v1/partner/${kind}/${id}`), onSuccess: done, onError });
  const confirmRemove = () =>
    Alert.alert(t('catalog.deleteTitle'), t('catalog.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  return { save, remove, confirmRemove };
}
