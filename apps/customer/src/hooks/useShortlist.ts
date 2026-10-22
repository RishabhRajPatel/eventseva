import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SavedVendor } from '../lib/api';
import { keys } from '../lib/queryClient';

/** Saved vendors (the heart). Toggling updates the list at once and rolls back on error. */
export function useShortlist() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.shortlist, queryFn: api.shortlist });
  const ids = useMemo(() => new Set((query.data?.items ?? []).map((v) => v.id)), [query.data]);

  const mutation = useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) => (save ? api.save(id) : api.unsave(id)),
    onMutate: async ({ id, save }) => {
      await qc.cancelQueries({ queryKey: keys.shortlist });
      const before = qc.getQueryData<{ items: SavedVendor[] }>(keys.shortlist);
      if (before && !save) qc.setQueryData(keys.shortlist, { items: before.items.filter((v) => v.id !== id) });
      if (before && save) {
        // A stand-in row so the heart fills at once; the refetch brings the real card.
        const stub = { id, businessName: '', area: null, category: { slug: 'other', name: '' }, ratingAvg: 0, ratingCount: 0, cover: null, savedAt: '' };
        qc.setQueryData(keys.shortlist, { items: [stub, ...before.items] });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.shortlist, ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.shortlist }),
  });

  return {
    query,
    count: query.data?.items.length ?? 0,
    isSaved: (id: string) => ids.has(id),
    toggle: (id: string) => mutation.mutate({ id, save: !ids.has(id) }),
  };
}
