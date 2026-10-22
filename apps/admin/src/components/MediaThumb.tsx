'use client';
/* eslint-disable @next/next/no-img-element -- Cloudinary already sizes and formats these URLs. */
import { useState } from 'react';
import { cardImage, videoPoster, zoomImage } from '@eventseva/app-shared';
import { cloudName } from '@/lib/api';

export interface MediaLike {
  type: 'photo' | 'video';
  publicId: string;
  width: number;
  height: number;
  durationSec: number | null;
}

/** Card-sized preview; without NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME it shows the publicId instead. */
export function MediaThumb({ media, alt, width = 280 }: { media: MediaLike; alt: string; width?: number }) {
  // A missing or broken file still shows which upload it is.
  const [failed, setFailed] = useState(false);
  if (!cloudName || failed) {
    return (
      <div className="thumb-placeholder" role="img" aria-label={alt}>
        <b>{media.type === 'video' ? `Video${media.durationSec ? ` · ${formatDuration(media.durationSec)}` : ''}` : 'Photo'}</b>
        <span className="mono">{media.publicId}</span>
        <span>
          {media.width}×{media.height}
        </span>
      </div>
    );
  }
  const src =
    media.type === 'video' ? videoPoster(cloudName, media.publicId, width) : cardImage(cloudName, media.publicId, width, (width * 3) / 4);
  return <img className="thumb" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

/** Large preview for the moderation dialog. */
export function MediaPreview({ media, alt }: { media: MediaLike; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!cloudName || failed) {
    return (
      <div className="thumb-placeholder" style={{ aspectRatio: `${media.width || 4} / ${media.height || 3}`, maxHeight: '60vh' }}>
        <b>{cloudName ? 'The file could not be loaded' : 'No Cloudinary cloud name set'}</b>
        <span className="mono">{media.publicId}</span>
        <span>
          {media.width}×{media.height}
          {media.durationSec ? ` · ${formatDuration(media.durationSec)}` : ''}
        </span>
      </div>
    );
  }
  const src = media.type === 'video' ? videoPoster(cloudName, media.publicId, 800) : zoomImage(cloudName, media.publicId, 800);
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ display: 'block', width: '100%', maxHeight: '65vh', objectFit: 'contain', background: 'var(--ink)', borderRadius: 'var(--radius)' }}
    />
  );
}

export function formatDuration(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
