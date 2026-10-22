import { PixelRatio } from 'react-native';
import { cardImage, videoPoster, wideImage, type Media } from '@eventseva/app-shared';
import { CLOUDINARY_CLOUD_NAME } from './config';

/** URL for a square/card thumbnail, or null when Cloudinary is not set up yet. */
export function thumbUrl(m: Pick<Media, 'publicId'> & { type?: Media['type'] }, width: number, height: number): string | null {
  if (!CLOUDINARY_CLOUD_NAME) return null;
  if (m.type === 'video') return videoPoster(CLOUDINARY_CLOUD_NAME, m.publicId, width, PixelRatio.get());
  return cardImage(CLOUDINARY_CLOUD_NAME, m.publicId, width, height, PixelRatio.get());
}

export function wideUrl(m: Pick<Media, 'publicId'>, width: number): string | null {
  if (!CLOUDINARY_CLOUD_NAME) return null;
  return wideImage(CLOUDINARY_CLOUD_NAME, m.publicId, width, PixelRatio.get());
}

export const coverOf = (media: Media[]) => media.find((m) => m.isCover && m.type === 'photo') ?? media.find((m) => m.type === 'photo') ?? null;

/** The most photos and videos a vendor can have (the server sends the live limits with GET /media). */
export const MAX_PHOTOS = 30;
export const MAX_VIDEOS = 5;
export const MAX_MEDIA = MAX_PHOTOS + MAX_VIDEOS;

/** How many more files can be picked; rejected ones do not count against the limit. */
export function remainingSlots(media: Pick<Media, 'type' | 'status'>[], limits = { photos: MAX_PHOTOS, videos: MAX_VIDEOS }) {
  const live = media.filter((m) => m.status !== 'rejected');
  const photos = live.filter((m) => m.type === 'photo').length;
  const videos = live.length - photos;
  return Math.max(0, limits.photos - photos) + Math.max(0, limits.videos - videos);
}

/** Photos that count for review: at least one is needed before Submit. */
export const usablePhotoCount = (media: Pick<Media, 'type' | 'status'>[]) => media.filter((m) => m.type === 'photo' && m.status !== 'rejected').length;
