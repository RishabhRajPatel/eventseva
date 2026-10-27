'use client';
import { useState } from 'react';
import { formatDateTime } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { FormDialog } from '@/components/dialogs';
import { api } from '@/lib/api';
import type { AdminVendor } from '@/lib/admin-types';
import { grantFormErrors } from '@/lib/places';
import { REASON_LIMITS } from '@/lib/validate';

/** Super admins: free featured days, or stop featuring (e.g. after a complaint). */
export function VendorFeatured({ vendor: v, onDone }: { vendor: AdminVendor; onDone: () => void }) {
  const [open, setOpen] = useState<'grant' | 'stop' | null>(null);
  // The API sends null once the featured period has ended.
  const until = v.featuredUntil ?? null;
  const live = v.status === 'approved';

  return (
    <section className="box stack" aria-labelledby="featured-title">
      <h2 id="featured-title">Featured</h2>
      {until ? (
        <p>
          <span className="pill tone-success">Featured</span> until <b>{formatDateTime(until)}</b>
        </p>
      ) : (
        <p className="muted">Not featured.</p>
      )}
      <div className="stack-sm">
        <button type="button" className="btn btn-primary" disabled={!live} onClick={() => setOpen('grant')}>
          Give free featured days
        </button>
        {until || v.featuredUntil === undefined ? (
          <button type="button" className="btn btn-danger-outline" style={{ marginTop: '0.75rem' }} onClick={() => setOpen('stop')}>
            Stop featuring
          </button>
        ) : null}
      </div>
      <p className="small muted">
        {live ? 'Featured vendors show at the top of search. Free days are added after any days already bought.' : 'Only live (approved) vendors can be featured.'}
      </p>

      {open === 'grant' ? <GrantDialog vendor={v} onClose={() => setOpen(null)} onDone={onDone} /> : null}
      {open === 'stop' ? (
        <ActionDialog
          title="Stop featuring this vendor?"
          description={
            <p>
              <b>{v.businessName}</b> goes back to the normal search order now. Days already paid for are not refunded automatically.
            </p>
          }
          confirmLabel="Stop featuring"
          busyLabel="Stopping…"
          tone="danger"
          input={{ label: 'Reason (for the audit log)', limits: REASON_LIMITS.standard, presets: ['Open complaint', 'Paused by request'] }}
          onConfirm={(reason) => api.post(`/v1/admin/vendors/${v.id}/unfeature`, { reason })}
          successMessage="Vendor is no longer featured."
          onClose={() => setOpen(null)}
          onDone={onDone}
        />
      ) : null}
    </section>
  );
}

function GrantDialog({ vendor: v, onClose, onDone }: { vendor: AdminVendor; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const errors = grantFormErrors({ days, reason });
  return (
    <FormDialog
      title={`Give ${v.businessName} free featured days?`}
      confirmLabel={Number(days) > 0 && !errors.days ? `Give ${days} free day${days === '1' ? '' : 's'}` : 'Give featured days'}
      busyLabel="Saving…"
      valid={Object.keys(errors).length === 0}
      onConfirm={() => api.post(`/v1/admin/vendors/${v.id}/feature`, { days: Number(days), reason: reason.trim() })}
      successMessage={`${v.businessName} is featured for ${days} more day(s). The vendor is notified.`}
      onClose={onClose}
      onDone={onDone}
    >
      {(tried) => (
        <>
          <p>
            <b>{v.businessName}</b> shows at the top of search. Free of charge; recorded in the featured sales list as “granted”.
          </p>
          <div className="field">
            <label htmlFor="grant-days">Days</label>
            <input
              id="grant-days"
              className="input"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-invalid={tried && errors.days ? true : undefined}
              autoFocus
            />
            {tried && errors.days ? <span className="field-error">{errors.days}</span> : <span className="hint">1 to 365.</span>}
          </div>
          <div className="field">
            <label htmlFor="grant-reason">Reason (shown to the vendor)</label>
            <input
              id="grant-reason"
              className="input"
              maxLength={300}
              placeholder="e.g. Launch offer"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && errors.reason ? true : undefined}
            />
            {tried && errors.reason ? <span className="field-error">{errors.reason}</span> : <span className="hint">3–300 characters.</span>}
          </div>
        </>
      )}
    </FormDialog>
  );
}
