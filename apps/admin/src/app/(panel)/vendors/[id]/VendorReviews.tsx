'use client';
import { useState } from 'react';
import { formatDateTime, type Paged, type Review } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { EmptyState, ErrorState, LoadingState, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import { humanize } from '@/lib/labels';
import { REASON_LIMITS } from '@/lib/validate';
import styles from './vendor.module.css';

/** Public reviews of a vendor, with Hide for support. Below the fold: loaded in its own chunk. */
export function Reviews({ vendorId, canHide, onHidden }: { vendorId: string; canHide: boolean; onHidden: () => void }) {
  const [page, setPage] = useState(1);
  const [hiding, setHiding] = useState<Review | null>(null);
  const state = useApiQuery<Paged<Review>>(`/v1/vendors/${vendorId}/reviews`, { page }, false);

  return (
    <section className="box stack" aria-labelledby="reviews-title">
      <div className="section-head">
        <h2 id="reviews-title">Public reviews</h2>
        <RefreshingHint show={state.refreshing} />
      </div>
      {state.error ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : state.loading || !state.data ? (
        <LoadingState label="Loading reviews…" />
      ) : state.data.items.length === 0 ? (
        <EmptyState title={page === 1 ? 'No reviews yet' : 'No more reviews'} icon="☆">
          {page === 1 ? 'Customers can review after a completed booking.' : null}
        </EmptyState>
      ) : (
        <div>
          {state.data.items.map((r) => (
            <article key={r.id} className={styles.review}>
              <div className={styles.reviewHead}>
                <span>
                  <span className={styles.stars} aria-label={`${r.rating} out of 5`}>
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </span>{' '}
                  <b>{r.customerName}</b>
                  <span className="muted small">
                    {' '}
                    · {formatDateTime(r.createdAt)}
                    {r.eventType ? ` · ${humanize(r.eventType)}` : ''}
                  </span>
                </span>
                {canHide ? (
                  <button type="button" className="btn btn-small btn-danger-outline" onClick={() => setHiding(r)} aria-label={`Hide review by ${r.customerName}`}>
                    Hide review
                  </button>
                ) : null}
              </div>
              {r.comment ? <p>{r.comment}</p> : <p className="muted small">No comment.</p>}
              {r.vendorReply ? (
                <p className="quote small">
                  <b>Vendor reply:</b> {r.vendorReply}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {state.data && (page > 1 || state.data.hasMore) ? (
        <div className="btn-row">
          {page > 1 ? (
            <button type="button" className="btn btn-small" onClick={() => setPage(page - 1)}>
              ← Newer
            </button>
          ) : null}
          {state.data.hasMore ? (
            <button type="button" className="btn btn-small" onClick={() => setPage(page + 1)}>
              Older →
            </button>
          ) : null}
        </div>
      ) : null}

      {hiding ? (
        <ActionDialog
          title="Hide this review?"
          description={
            <>
              <p className="quote">
                {hiding.rating}★ {hiding.customerName}: {hiding.comment ?? 'No comment.'}
              </p>
              <p>It disappears from the vendor page and the rating is recalculated. This cannot be undone here.</p>
            </>
          }
          confirmLabel="Hide review"
          busyLabel="Hiding…"
          tone="danger"
          input={{
            label: 'Reason (for the audit log)',
            limits: REASON_LIMITS.standard,
            presets: ['Fake review', 'Abusive language', 'Not about this vendor'],
          }}
          onConfirm={(reason) => api.post(`/v1/admin/reviews/${hiding.id}/hide`, { reason })}
          successMessage="Review hidden."
          onClose={() => setHiding(null)}
          onDone={() => {
            state.reload();
            onHidden();
          }}
        />
      ) : null}
    </section>
  );
}
