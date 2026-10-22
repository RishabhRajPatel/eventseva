'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime, formatPhone, rupees, type Paged, type Review } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { MediaActions } from '@/components/MediaActions';
import { MediaThumb } from '@/components/MediaThumb';
import { useShell } from '@/components/ShellContext';
import { EmptyState, ErrorState, Fact, LoadingState, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { AdminVendor } from '@/lib/admin-types';
import { historyLabel, humanize, MEDIA_STATUS, UNIT_LABELS, VENDOR_STATUS, vendorDecisions, type VendorDecision } from '@/lib/labels';
import { can } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';
import { VendorDocuments } from './VendorDocuments';
import { VendorBank } from './VendorBank';
import styles from './vendor.module.css';

const VENDOR_REJECT_PRESETS = [
  'Documents are not clear',
  'Business name does not match the documents',
  'Photos do not look like real work',
  'Profile details are incomplete',
];

export function VendorDetailView() {
  const { id } = useParams<{ id: string }>();
  const state = useApiQuery<AdminVendor>(`/v1/admin/vendors/${id}`);

  return (
    <div className="page">
      <Link href="/vendors" className="small">
        ← Vendors
      </Link>
      <QueryView state={state} notFound="This vendor does not exist." loadingLabel="Loading vendor…">
        {(v) => <VendorDetail vendor={v} reload={state.reload} refreshing={state.refreshing} receivedAt={state.receivedAt} />}
      </QueryView>
    </div>
  );
}

function VendorDetail({
  vendor: v,
  reload,
  refreshing,
  receivedAt,
}: {
  vendor: AdminVendor;
  reload: () => void;
  refreshing: boolean;
  receivedAt: number | undefined;
}) {
  const { session } = useShell();
  const role = session.admin.role;
  const canModerate = can(role, 'media.moderate');

  return (
    <>
      <div className="page-head">
        <div className="stack-sm">
          <div className={styles.title}>
            <h1>{v.businessName}</h1>
            <StatusPill map={VENDOR_STATUS} status={v.status} />
            <RefreshingHint show={refreshing} />
          </div>
          <p className="muted">
            {v.category.name} · {[v.area, v.city.name].filter(Boolean).join(', ')}
            {v.owner ? ` · ${formatPhone(v.owner.phone)}` : ''}
          </p>
        </div>
      </div>

      <div className={styles.layout}>
        <div className="stack">
          {v.rejectReason && (v.status === 'rejected' || v.status === 'on_hold') ? (
            <p className="note note-warning">
              <span>
                <b>{v.status === 'rejected' ? 'Rejected' : 'On hold'}:</b> {v.rejectReason}
              </span>
            </p>
          ) : null}

          <section className="box stack" aria-labelledby="profile-title">
            <h2 id="profile-title">Profile</h2>
            {v.about ? <p className="quote">“{v.about}”</p> : <p className="muted">No “about” text yet.</p>}
            <dl className="facts">
              <Fact label="Category">{v.category.name}</Fact>
              <Fact label="City">{v.city.name}</Fact>
              <Fact label="Area">{v.area ?? '—'}</Fact>
              <Fact label="Address">{v.address ?? '—'}</Fact>
              <Fact label="Location">
                {v.location ? (
                  <a href={`https://www.google.com/maps?q=${v.location.lat},${v.location.lng}`} target="_blank" rel="noreferrer">
                    {v.location.lat.toFixed(5)}, {v.location.lng.toFixed(5)}
                  </a>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label="Owner">{v.owner?.name ?? '—'}</Fact>
              <Fact label="Owner phone">{v.owner ? formatPhone(v.owner.phone) : '—'}</Fact>
              <Fact label="Rating">{v.rating.count ? `${v.rating.avg.toFixed(1)} ★ (${v.rating.count})` : 'No reviews yet'}</Fact>
              <Fact label="Created">{v.createdAt ? formatDateTime(v.createdAt) : '—'}</Fact>
              <Fact label="Approved">{v.approvedAt ? formatDateTime(v.approvedAt) : '—'}</Fact>
            </dl>
          </section>

          <VendorDocuments vendor={v} receivedAt={receivedAt} onDone={reload} />

          {can(role, 'payout.manage') ? <VendorBank vendorId={v.id} businessName={v.businessName} /> : null}

          <Services vendor={v} />

          <section className="box stack" aria-labelledby="media-title">
            <div className="section-head">
              <h2 id="media-title">Photos and videos ({v.media.length})</h2>
              {canModerate ? <Link href="/photos">Open photo queue</Link> : null}
            </div>
            {v.media.length === 0 ? (
              <p className="muted">No photos uploaded yet.</p>
            ) : (
              <div className={styles.mediaGrid}>
                {v.media.map((m, i) => (
                  <div key={m.id} className={styles.mediaItem}>
                    <MediaThumb media={m} alt={`${v.businessName} ${m.type} ${i + 1}`} width={200} />
                    <div className={styles.meta}>
                      <div className="btn-row" style={{ gap: '0.375rem' }}>
                        {m.status ? <StatusPill map={MEDIA_STATUS} status={m.status} /> : null}
                        {m.isCover ? <span className="pill tone-info">Cover</span> : null}
                      </div>
                      {m.rejectReason ? <span className="muted">{m.rejectReason}</span> : null}
                      {canModerate && m.status ? (
                        <MediaActions id={m.id} status={m.status} label={v.businessName} name={`${m.type} ${i + 1}`} type={m.type} onDone={reload} compact />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Reviews vendorId={v.id} canHide={can(role, 'review.hide')} onHidden={reload} />
        </div>

        <div className={`stack ${styles.decide}`}>
          {can(role, 'vendor.decide') ? <Decision vendor={v} onDone={reload} /> : null}
          <History vendor={v} />
        </div>
      </div>
    </>
  );
}

function Services({ vendor: v }: { vendor: AdminVendor }) {
  return (
    <section className="box stack" aria-labelledby="services-title">
      <h2 id="services-title">Services and packages</h2>
      {v.services.length === 0 && v.packages.length === 0 ? <p className="muted">No services or packages yet.</p> : null}
      {v.services.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">Guests</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {v.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="cell-main">{s.title}</span>
                    {s.description ? <span className="cell-sub">{s.description}</span> : null}
                  </td>
                  <td className="num">
                    {rupees(s.pricePaise)} <span className="cell-sub">{UNIT_LABELS[s.unit] ?? humanize(s.unit)}</span>
                  </td>
                  <td className="nowrap">{s.minGuests || s.maxGuests ? `${s.minGuests ?? '—'} to ${s.maxGuests ?? '—'}` : '—'}</td>
                  <td>{s.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {v.packages.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Package</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {v.packages.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="cell-main">{p.title}</span>
                    {p.items.length ? (
                      <ul className={styles.packageItems}>
                        {p.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="num">{rupees(p.pricePaise)}</td>
                  <td>{p.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const DECISION_COPY: Record<VendorDecision, { button: string; title: string; done: string }> = {
  approve: { button: 'Approve, make profile live', title: 'Approve this vendor?', done: 'Vendor approved. The profile is live.' },
  hold: { button: 'Hold', title: 'Put this vendor on hold?', done: 'Vendor put on hold.' },
  reject: { button: 'Reject', title: 'Reject this vendor?', done: 'Vendor rejected. They can fix and resubmit.' },
};

function Decision({ vendor: v, onDone }: { vendor: AdminVendor; onDone: () => void }) {
  const [open, setOpen] = useState<VendorDecision | null>(null);
  const decisions = vendorDecisions(v.status);

  return (
    <section className="box stack" aria-labelledby="decide-title">
      <h2 id="decide-title">Decision</h2>
      {decisions.length === 0 ? (
        <p className="muted">
          {v.status === 'draft'
            ? 'The vendor has not submitted the profile for review yet.'
            : 'The vendor must edit and resubmit before a new decision.'}
        </p>
      ) : (
        <div className="stack-sm">
          {decisions.map((d) => (
            <button key={d} type="button" className={`btn ${d === 'approve' ? 'btn-primary' : ''}`} onClick={() => setOpen(d)}>
              {DECISION_COPY[d].button}
            </button>
          ))}
        </div>
      )}
      <DocumentsHint vendor={v} />
      <p className="small muted">The vendor is notified in the Partner app. Every decision is recorded in the history below.</p>

      {open ? (
        <ActionDialog
          title={DECISION_COPY[open].title}
          description={
            open === 'approve' ? (
              <p>
                <b>{v.businessName}</b> becomes visible to customers and can receive bookings.
              </p>
            ) : open === 'hold' ? (
              <p>
                <b>{v.businessName}</b> is hidden from customers until approved again.
              </p>
            ) : (
              <p>
                <b>{v.businessName}</b> goes back to editing. Say clearly what to fix.
              </p>
            )
          }
          confirmLabel={open === 'approve' ? 'Approve' : open === 'hold' ? 'Put on hold' : 'Reject'}
          tone={open === 'approve' ? 'primary' : 'danger'}
          input={
            open === 'approve'
              ? undefined
              : { label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.vendor, presets: VENDOR_REJECT_PRESETS, multiline: true }
          }
          onConfirm={(reason) => api.post(`/v1/admin/vendors/${v.id}/${open}`, open === 'approve' ? {} : { reason })}
          successMessage={DECISION_COPY[open].done}
          onClose={() => setOpen(null)}
          onDone={onDone}
        />
      ) : null}
    </section>
  );
}

/** Reminds the verifier before approving a vendor whose documents are not all checked. */
function DocumentsHint({ vendor: v }: { vendor: AdminVendor }) {
  const docs = v.documents ?? [];
  const open = docs.filter((d) => d.status !== 'approved').length;
  if (!vendorDecisions(v.status).includes('approve')) return null;
  if (docs.length === 0) return <p className="note note-warning">No ID documents uploaded yet.</p>;
  if (open === 0) return null;
  return (
    <p className="note note-warning">
      {open} of {docs.length} documents not approved yet.
    </p>
  );
}

function History({ vendor: v }: { vendor: AdminVendor }) {
  return (
    <section className="box stack" aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      {v.history.length === 0 ? (
        <p className="muted">No admin actions yet.</p>
      ) : (
        <ol className={styles.history}>
          {v.history.map((h, i) => (
            <li key={i}>
              <b>{historyLabel(h.action)}</b> · {formatDateTime(h.createdAt)}
              <br />
              <span className="muted">{h.adminEmail}</span>
              {h.reason ? <p>“{h.reason}”</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Reviews({ vendorId, canHide, onHidden }: { vendorId: string; canHide: boolean; onHidden: () => void }) {
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
        <EmptyState title={page === 1 ? 'No reviews yet' : 'No more reviews'} />
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
                  <button type="button" className="btn btn-small" onClick={() => setHiding(r)}>
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
