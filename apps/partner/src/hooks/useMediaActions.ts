import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { confirm } from '../lib/confirm';
import { errorText } from '../lib/errors';
import { haptic } from '../lib/haptics';
import { invalidateMedia, keys, type MediaPage } from '../lib/queries';
import { toast } from '../lib/toast';

/** How long a deleted photo can be brought back with Undo (UX.md §4). */
export const UNDO_MS = 5000;

/**
 * Delete, make cover and re-order for the Photos screen.
 * - The cover photo and videos ask first ("Delete this video?").
 * - Other photos disappear at once with an Undo toast; the API is called only when the 5 s pass
 *   without Undo, and the tile comes back if that call fails.
 */
export function useMediaActions(media: Media[]) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  const setHiddenSafe = useCallback((fn: (s: Set<string>) => void) => {
    if (!mounted.current) return;
    setHidden((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
  }, []);

  const deleteNow = useCallback(
    async (m: Media) => {
      try {
        await api.delete(`/v1/partner/media/${m.id}`);
        invalidateMedia(qc);
        return true;
      } catch (e) {
        // Put the tile back and say why.
        setHiddenSafe((s) => s.delete(m.id));
        toast.error(t('photos.deleteFailed', { reason: errorText(t, e) }));
        return false;
      }
    },
    [qc, t, setHiddenSafe],
  );

  // Leaving the screen inside the 5 s still deletes: that is what the vendor asked for.
  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      pending.forEach((timer, id) => {
        clearTimeout(timer);
        void api
          .delete(`/v1/partner/media/${id}`)
          .catch(() => undefined)
          .finally(() => invalidateMedia(qc));
      });
      pending.clear();
    };
  }, [qc]);

  const remove = useCallback(
    async (m: Media) => {
      const video = m.type === 'video';
      if (video || m.isCover) {
        const ok = await confirm({
          title: t(video ? 'photos.deleteVideoTitle' : 'photos.deleteCoverTitle'),
          body: t(video ? 'photos.deleteVideoBody' : 'photos.deleteCoverBody'),
          confirmLabel: t(video ? 'photos.deleteVideo' : 'photos.deletePhoto'),
          cancelLabel: t('common.keep'),
          destructive: true,
        });
        if (!ok) return;
        setHiddenSafe((s) => s.add(m.id));
        if (await deleteNow(m)) toast.success(t(video ? 'photos.videoDeleted' : 'photos.photoDeleted'));
        return;
      }
      haptic.warning();
      setHiddenSafe((s) => s.add(m.id));
      const timer = setTimeout(() => {
        timers.current.delete(m.id);
        void deleteNow(m);
      }, UNDO_MS);
      timers.current.set(m.id, timer);
      toast.show({
        message: t('photos.photoDeleted'),
        tone: 'info',
        duration: UNDO_MS,
        testID: 'undo-toast',
        action: {
          label: t('common.undo'),
          onPress: () => {
            clearTimeout(timer);
            timers.current.delete(m.id);
            setHiddenSafe((s) => s.delete(m.id));
            haptic.select();
          },
        },
      });
    },
    [t, deleteNow, setHiddenSafe],
  );

  const makeCover = useMutation({
    mutationFn: (id: string) => api.post(`/v1/partner/media/${id}/cover`),
    onMutate: (id) => {
      const before = qc.getQueryData<MediaPage>(keys.media);
      qc.setQueryData<MediaPage>(keys.media, (old) => (old ? { ...old, items: old.items.map((x) => ({ ...x, isCover: x.id === id })) } : old));
      return { before };
    },
    onSuccess: () => toast.success(t('photos.coverChanged')),
    onError: (e, _id, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.media, ctx.before);
      toast.error(errorText(t, e));
    },
    onSettled: () => invalidateMedia(qc),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put('/v1/partner/media/order', { ids }),
    onMutate: (ids) => {
      // Show the new order at once; put the old one back if the server says no.
      const before = qc.getQueryData<MediaPage>(keys.media);
      qc.setQueryData<MediaPage>(keys.media, (old) => (old ? { ...old, items: ids.map((id) => old.items.find((m) => m.id === id)!).filter(Boolean) } : old));
      return { before };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.media, ctx.before);
      toast.error(errorText(t, e));
    },
    onSettled: () => invalidateMedia(qc),
  });

  const move = useCallback(
    (m: Media, by: -1 | 1) => {
      const ids = media.map((x) => x.id);
      const i = ids.indexOf(m.id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      haptic.select();
      reorder.mutate(ids);
    },
    [media, reorder],
  );

  const visible = useMemo(() => media.filter((m) => !hidden.has(m.id)), [media, hidden]);
  return { visible, remove, makeCover: (id: string) => makeCover.mutate(id), move };
}
