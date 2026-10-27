import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type SavedVendor } from '../lib/api';
import { errorText } from '../lib/errors';
import { haptic } from '../lib/haptics';
import { keys } from '../lib/queryClient';
import { useToast } from '../components/Toast';

type Shortlist = { items: SavedVendor[] };
type Toggle = { id: string; save: boolean; /** The full row, when known, so an Undo puts back the real card. */ row?: SavedVendor };

/** A stand-in row so the heart fills at once; the refetch brings the real card. */
const stub = (id: string): SavedVendor => ({
  id,
  businessName: '',
  area: null,
  category: { slug: 'other', name: '', icon: 'other' },
  ratingAvg: 0,
  ratingCount: 0,
  cover: null,
  savedAt: '',
});

/**
 * Saved vendors (the heart). Toggling updates the list at once (optimistic), says so in a toast
 * ("Saved" / "Removed · Undo") and rolls back with an error toast if the server says no.
 */
export function useShortlist() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();
  const query = useQuery({ queryKey: keys.shortlist, queryFn: api.shortlist, staleTime: 60_000 });
  const ids = useMemo(() => new Set((query.data?.items ?? []).map((v) => v.id)), [query.data]);

  const mutation = useMutation({
    mutationFn: ({ id, save }: Toggle) => (save ? api.save(id) : api.unsave(id)),
    onMutate: async ({ id, save, row }) => {
      await qc.cancelQueries({ queryKey: keys.shortlist });
      const before = qc.getQueryData<Shortlist>(keys.shortlist);
      if (before) {
        const rest = before.items.filter((v) => v.id !== id);
        qc.setQueryData<Shortlist>(keys.shortlist, { items: save ? [row ?? stub(id), ...rest] : rest });
      }
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.shortlist, ctx.before);
      haptic.error();
      toast.error(errorText(t, e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.shortlist }),
  });

  const { mutate } = mutation;
  const toggle = useCallback(
    (id: string) => {
      const save = !ids.has(id);
      const row = qc.getQueryData<Shortlist>(keys.shortlist)?.items.find((v) => v.id === id);
      haptic.select();
      mutate({ id, save });
      if (save) toast.success(t('saved.added'));
      else toast.info(t('saved.removed'), { action: { label: t('common.undo'), onPress: () => mutate({ id, save: true, row }) } });
    },
    [ids, mutate, qc, t, toast],
  );

  return {
    query,
    count: query.data?.items.length ?? 0,
    isSaved: (id: string) => ids.has(id),
    toggle,
  };
}
