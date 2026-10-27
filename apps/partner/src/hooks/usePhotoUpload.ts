import { useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { MAX_PHOTOS, MAX_VIDEOS } from '../lib/media';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { checkFile, UploadError, type PickedFile } from '../lib/upload';
import { mediaUploads, type UploadItem, type UploadQueue } from '../lib/uploadQueue';

export interface Limits {
  photos: number;
  videos: number;
}

/** Free photo and video places, not counting rejected files or files still uploading. */
export function slotsLeft(media: Pick<Media, 'type' | 'status'>[], queued: Pick<UploadItem, 'file' | 'state'>[], limits: Limits = { photos: MAX_PHOTOS, videos: MAX_VIDEOS }) {
  const live = media.filter((m) => m.status !== 'rejected');
  const pending = queued.filter((q) => q.state !== 'failed' && q.state !== 'done');
  const count = (type: 'photo' | 'video') => live.filter((m) => m.type === type).length + pending.filter((q) => q.file.type === type).length;
  return { photos: Math.max(0, limits.photos - count('photo')), videos: Math.max(0, limits.videos - count('video')) };
}

export const toPicked = (a: ImagePicker.ImagePickerAsset): PickedFile => ({
  uri: a.uri,
  type: a.type === 'video' ? 'video' : 'photo',
  width: a.width,
  height: a.height,
  fileSize: a.fileSize,
  mimeType: a.mimeType,
  fileName: a.fileName,
  durationMs: a.duration,
});

/**
 * Pick photos/videos and hand them to the shared upload queue. Every file gets a tile at once;
 * files the phone can already refuse (too long, too big, over the limit) show why straight away.
 */
export function usePhotoUpload({ media, limits, videos = true, queue = mediaUploads }: { media: Pick<Media, 'type' | 'status'>[]; limits?: Limits; videos?: boolean; queue?: UploadQueue }) {
  const { t } = useTranslation();
  const items = useStore(queue.store);
  const left = slotsLeft(media, items, limits);
  const total = left.photos + (videos ? left.videos : 0);

  const pick = useCallback(async () => {
    if (total <= 0) {
      toast.info(t('photos.limitBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: videos && left.videos > 0 ? ['images', 'videos'] : ['images'],
      allowsMultipleSelection: true,
      selectionLimit: total,
      orderedSelection: true,
      // We resize and compress ourselves (≤ 2000 px, JPEG 0.8), so take the original.
      quality: 1,
    });
    if (result.canceled || !result.assets.length) return;
    const files = result.assets.map(toPicked);
    // Count against the photo and video limits separately; extra files show "limit reached".
    const room = { ...left };
    const problems = files.map((f) => {
      const problem = checkFile(f);
      if (problem) return problem;
      const key = f.type === 'video' ? 'videos' : 'photos';
      if (room[key] <= 0) return new UploadError('LIMIT_REACHED', 'Limit reached.', { limit: key });
      room[key]--;
      return null;
    });
    queue.add(files, problems);
  }, [total, videos, left, queue, t]);

  return {
    pick,
    items,
    busy: items.some((i) => i.state === 'waiting' || i.state === 'uploading'),
    canAdd: total > 0,
    cancel: (id: string) => queue.cancel(id),
    retry: (id: string) => queue.retry(id),
    dismiss: (id: string) => queue.dismiss(id),
  };
}
