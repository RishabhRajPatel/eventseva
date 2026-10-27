import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { confirm } from '../lib/confirm';
import { errorText } from '../lib/errors';
import { invalidateVendor } from '../lib/queries';
import { toast } from '../lib/toast';

/** Save / delete for a service or package; a toast for the result, then back to the list. */
export function useCatalogMutations(kind: 'services' | 'packages', id: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const one = kind === 'services' ? 'service' : 'package';
  const onError = (e: unknown) => toast.error(errorText(t, e));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (id ? api.patch(`/v1/partner/${kind}/${id}`, body) : api.post(`/v1/partner/${kind}`, body)),
    onSuccess: () => {
      invalidateVendor(qc);
      toast.success(t(id ? `${one}.saved` : `${one}.added`));
      router.back();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/partner/${kind}/${id}`),
    onSuccess: () => {
      invalidateVendor(qc);
      toast.success(t(`${one}.deleted`));
      router.back();
    },
    onError,
  });
  /** "Delete “DJ night”?" with what happens and an action-named button. */
  const confirmRemove = async (name: string) => {
    if (remove.isPending) return;
    const ok = await confirm({
      title: t('catalog.deleteTitleNamed', { name }),
      body: t('catalog.deleteBody'),
      confirmLabel: t(`${one}.delete`),
      cancelLabel: t('common.keep'),
      destructive: true,
    });
    if (ok) remove.mutate();
  };
  return { save, remove, confirmRemove };
}
