'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { REASON_LIMITS } from '@/lib/validate';
import { ActionDialog } from './dialogs';

export const MEDIA_REJECT_PRESETS = [
  'Blurry or too dark',
  'Duplicate photo',
  'Not the vendor’s own work',
  'Screenshot or shows contact details',
];

/** Approve / Reject buttons for one photo or video, each behind a confirmation. */
export function MediaActions({
  id,
  status,
  label,
  onDone,
  compact = false,
  name = 'photo',
  type = 'photo',
}: {
  id: string;
  status: string;
  label: string;
  onDone: () => void;
  compact?: boolean;
  /** Accessible name of the item, e.g. "photo 2 of Raj DJ Sound", so each button is distinct. */
  name?: string;
  type?: 'photo' | 'video';
}) {
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const size = compact ? 'btn-small' : '';
  return (
    <>
      <div className="btn-row" style={compact ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' } : undefined}>
        {status !== 'rejected' ? (
          <button type="button" className={`btn btn-danger-outline ${size}`} onClick={() => setDialog('reject')} aria-label={`Reject ${name}`}>
            Reject
          </button>
        ) : null}
        {status !== 'approved' ? (
          <button type="button" className={`btn btn-primary ${size}`} onClick={() => setDialog('approve')} aria-label={`Approve ${name}`}>
            Approve
          </button>
        ) : null}
      </div>
      {dialog === 'approve' ? (
        <ActionDialog
          title={`Approve this ${type}?`}
          description={<p>It becomes visible to customers on {label}’s profile.</p>}
          confirmLabel={`Approve ${type}`}
          busyLabel="Approving…"
          onConfirm={() => api.post(`/v1/admin/media/${id}/approve`)}
          successMessage={type === 'video' ? 'Video approved.' : 'Photo approved.'}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
      {dialog === 'reject' ? (
        <ActionDialog
          title={`Reject this ${type}?`}
          description={<p>{label} gets a notification with the reason.</p>}
          confirmLabel={`Reject ${type}`}
          busyLabel="Rejecting…"
          tone="danger"
          input={{
            label: 'Reason (shown to the vendor)',
            limits: REASON_LIMITS.standard,
            presets: MEDIA_REJECT_PRESETS,
          }}
          onConfirm={(reason) => api.post(`/v1/admin/media/${id}/reject`, { reason })}
          successMessage={`${type === 'video' ? 'Video' : 'Photo'} rejected. The vendor has been told why.`}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}
