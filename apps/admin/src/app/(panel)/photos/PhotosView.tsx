'use client';
import Link from 'next/link';
import { memo, useRef, useState } from 'react';
import { formatDateTime, type Paged } from '@eventseva/app-shared';
import { MediaActions } from '@/components/MediaActions';
import { formatDuration, MediaPreview, MediaThumb } from '@/components/MediaThumb';
import { useShell } from '@/components/ShellContext';
import { CardSkeleton, EmptyAction, EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TabLinks } from '@/components/ui';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import type { AdminMedia } from '@/lib/admin-types';
import { cloudName } from '@/lib/api';
import { MEDIA_STATUS, MEDIA_STATUSES, pageFrom, type MediaStatus } from '@/lib/labels';
import styles from './photos.module.css';

const TAB_LABELS: Record<MediaStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

export function PhotosView() {
  const { params, hrefWith } = useUrlState();
  const { counts } = useShell();
  const status = (MEDIA_STATUSES.find((s) => s === params.get('status')) ?? 'pending') as MediaStatus;
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminMedia>>('/v1/admin/media', { status, page });
  const [preview, setPreview] = useState<AdminMedia | null>(null);

  return (
    <div className="page">
      <PageHead title="Photo moderation" subtitle="Oldest uploads first. Approved photos appear on the vendor’s public profile.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <TabLinks
        label="Photo status"
        current={status}
        tabs={MEDIA_STATUSES.map((s) => ({
          key: s,
          label: TAB_LABELS[s],
          href: hrefWith({ status: s === 'pending' ? null : s }),
          count: s === 'pending' ? counts?.pendingMedia : undefined,
        }))}
      />

      {!cloudName ? (
        <p className="note note-warning">
          NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME is not set, so previews show the Cloudinary publicId instead of the photo.
        </p>
      ) : null}

      <QueryView
        state={state}
        skeleton={<CardSkeleton count={8} minWidth="15rem" height="16rem" label="Loading photos…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title={status === 'pending' ? 'Queue is empty' : 'Nothing here'}
            icon={status === 'pending' ? '✓' : '∅'}
            action={<EmptyAction href={status === 'pending' ? '/photos?status=approved' : '/photos'}>{status === 'pending' ? 'See approved photos →' : 'Back to the queue →'}</EmptyAction>}
          >
            {status === 'pending' ? 'Every uploaded photo has been reviewed.' : `No ${status} photos.`}
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <PhotoGrid items={data.items} status={status} onPreview={setPreview} onDone={state.reload} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>

      <p className="small muted">
        When rejecting, pick a clear reason (blurry, duplicate, not their work, screenshot). The vendor sees exactly that text.
      </p>

      {preview ? <PreviewDialog media={preview} onClose={() => setPreview(null)} onDone={state.reload} /> : null}
    </div>
  );
}

const PhotoGrid = memo(function PhotoGrid({
  items,
  status,
  onPreview,
  onDone,
}: {
  items: AdminMedia[];
  status: MediaStatus;
  onPreview: (m: AdminMedia) => void;
  onDone: () => void;
}) {
  return (
    <div className={styles.grid}>
      {items.map((m) => (
        <article key={m.id} className={styles.card}>
          <button type="button" className="thumb-button" onClick={() => onPreview(m)} aria-label={`Preview ${m.type} from ${m.vendorName}`}>
            <MediaThumb media={m} alt="" />
            {m.type === 'video' ? <span className="pill tone-dark thumb-tag">Video{m.durationSec ? ` ${formatDuration(m.durationSec)}` : ''}</span> : null}
          </button>
          <div className={styles.body}>
            <span>
              <Link href={`/vendors/${m.vendorId}`}>{m.vendorName}</Link>
            </span>
            <span className="muted">Uploaded {formatDateTime(m.createdAt)}</span>
            {status !== 'pending' ? <StatusPill map={MEDIA_STATUS} status={m.status} /> : null}
            {m.rejectReason ? <span className="muted">Reason: {m.rejectReason}</span> : null}
            <MediaActions id={m.id} status={m.status} label={m.vendorName} name={`${m.type} from ${m.vendorName}`} type={m.type} onDone={onDone} compact />
          </div>
        </article>
      ))}
    </div>
  );
});

function PreviewDialog({ media, onClose, onDone }: { media: AdminMedia; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const dialogProps = useModalDialog(ref, { busy: false, onClose });

  return (
    <dialog ref={ref} className="dialog dialog-wide" aria-label={`Preview from ${media.vendorName}`} {...dialogProps}>
      <div className="dialog-body">
        <div className="section-head">
          <h2>{media.vendorName}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <MediaPreview media={media} alt={`${media.type} from ${media.vendorName}`} />
        <div className="section-head">
          <span className="small muted">
            {media.width}×{media.height}
            {media.durationSec ? ` · ${formatDuration(media.durationSec)}` : ''} · uploaded {formatDateTime(media.createdAt)}
          </span>
          <MediaActions
            id={media.id}
            status={media.status}
            label={media.vendorName}
            type={media.type}
            onDone={() => {
              onClose();
              onDone();
            }}
          />
        </div>
      </div>
    </dialog>
  );
}
