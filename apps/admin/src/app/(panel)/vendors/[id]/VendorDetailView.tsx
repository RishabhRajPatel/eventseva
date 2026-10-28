'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime, formatPhone, rupees } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { MediaActions } from '@/components/MediaActions';
import { MediaThumb } from '@/components/MediaThumb';
import { useShell } from '@/components/ShellContext';
import { Fact, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { AdminVendor } from '@/lib/admin-types';
import type { EngineService, ServiceConfigChange } from '@eventseva/app-shared';
import { historyLabel, humanize, MEDIA_STATUS, UNIT_LABELS, VENDOR_STATUS, vendorDecisions, type VendorDecision } from '@/lib/labels';
import { can } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';
import { VendorDocuments } from './VendorDocuments';
import styles from './vendor.module.css';
import { closedBookingsMessage } from '@/lib/closed-bookings';

// Role-specific sections (finance: bank account; super: featured) load only for those roles.
const sectionSkeleton = () => <div className="skel-box" aria-hidden="true" style={{ minHeight: '8rem' }} />;
const VendorBank = dynamic(() => import('./VendorBank').then((m) => m.VendorBank), { loading: sectionSkeleton });
const Reviews = dynamic(() => import('./VendorReviews').then((m) => m.Reviews), { loading: sectionSkeleton });
const VendorFeatured = dynamic(() => import('./VendorFeatured').then((m) => m.VendorFeatured), { loading: sectionSkeleton });

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
          {can(role, 'service.history') ? <ConfigurableServices vendorId={v.id} /> : null}

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
          {can(role, 'featured.grant') ? <VendorFeatured vendor={v} onDone={reload} /> : null}
          <History vendor={v} />
        </div>
      </div>
    </>
  );
}

/** What the vendor changed on one service, newest first (bookings keep their own copy). */
function ServiceHistory({ serviceId }: { serviceId: string }) {
  const state = useApiQuery<{ items: ServiceConfigChange[] }>(`/v1/admin/services/${serviceId}/history`);
  return (
    <QueryView state={state} loadingLabel="Loading changes" isEmpty={(d) => d.items.length === 0} empty={<p className="muted">No changes since it was added.</p>}>
      {(d) => (
        <ol className="stack" aria-label="Service changes">
          {d.items.map((h) => (
            <li key={h.version}>
              <strong>Version {h.version}</strong> · {formatDateTime(h.createdAt)} · {Object.keys(h.changes).map(humanize).join(', ')}
              <details>
                <summary>Before and after</summary>
                <pre className="code-block">{JSON.stringify(h.changes, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </QueryView>
  );
}

type ConfiguredService = EngineService & { disabledAt: string | null };

/**
 * Services booked by time or quantity, and rentals: how the vendor set them up (price, ways to book,
 * events, questions, rules), what they changed, and taking one off the app when it is unsafe or misleading.
 */
function ConfigurableServices({ vendorId }: { vendorId: string }) {
  const state = useApiQuery<{ items: ConfiguredService[] }>('/v1/admin/services', { vendorId });
  const [history, setHistory] = useState<string | null>(null);
  const [acting, setActing] = useState<ConfiguredService | null>(null);
  return (
    <section className="box stack" aria-labelledby="config-title">
      <h2 id="config-title">Booking settings</h2>
      <QueryView state={state} loadingLabel="Loading services" isEmpty={(d) => d.items.length === 0} empty={<p className="muted">No services booked by time, quantity or rental.</p>}>
        {(d) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Price</th>
                  <th scope="col">Ways to book</th>
                  <th scope="col">Events</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="cell-main">{s.title}</span>
                      <span className="cell-sub">{humanize(s.bookingType)}</span>
                    </td>
                    <td className="nowrap">
                      {s.pricing.model === 'quote' ? 'On request' : `${rupees(s.pricing.ratePaise)} ${humanize(s.pricing.model)}`}
                      {s.pricing.adjustments?.length ? <span className="cell-sub">{s.pricing.adjustments.length} price rule(s)</span> : null}
                    </td>
                    <td>{s.plans?.length ? s.plans.map((p) => `${p.name.en} (${p.pricing.model === 'quote' ? 'quote' : rupees(p.pricing.ratePaise)})`).join(', ') : '—'}</td>
                    <td>{s.eventTypes?.length ? s.eventTypes.map(humanize).join(', ') : 'All'}</td>
                    <td>{s.questions?.length ? s.questions.map((q) => q.label.en).join(', ') : '—'}</td>
                    <td className="num">{s.configVersion ?? 1}</td>
                    <td>{s.disabledAt ? <span title={s.disabledReason ?? ''}>Off: {s.disabledReason}</span> : 'On'}</td>
                    <td className="btn-row">
                      <button type="button" className="btn btn-small" aria-expanded={history === s.id} onClick={() => setHistory(history === s.id ? null : s.id)}>
                        {history === s.id ? 'Hide changes' : 'Changes'}
                      </button>
                      <button type="button" className={`btn btn-small ${s.disabledAt ? '' : 'btn-danger-outline'}`} onClick={() => setActing(s)}>
                        {s.disabledAt ? 'Put back' : 'Take off'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {history ? <ServiceHistory serviceId={history} /> : null}
      {acting ? (
        <ActionDialog
          title={acting.disabledAt ? `Put “${acting.title}” back on the app?` : `Take “${acting.title}” off the app?`}
          description={
            <p>
              {acting.disabledAt
                ? 'Customers can book it again; the vendor can edit it again.'
                : 'Customers stop seeing it and new bookings are refused. Open bookings go ahead. The vendor sees the reason and cannot switch it back on.'}
            </p>
          }
          confirmLabel={acting.disabledAt ? 'Put back' : 'Take off'}
          busyLabel="Saving…"
          tone={acting.disabledAt ? 'primary' : 'danger'}
          input={acting.disabledAt ? undefined : { label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.vendor, multiline: true }}
          onConfirm={(reason) => api.patch(`/v1/admin/services/${acting.id}/status`, acting.disabledAt ? { active: true } : { active: false, reason })}
          successMessage={() => (acting.disabledAt ? 'Service is back on the app.' : 'Service taken off the app.')}
          onClose={() => setActing(null)}
          onDone={state.reload}
        />
      ) : null}
    </section>
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

const DECISION_COPY: Record<VendorDecision, { button: string; title: string; confirm: string; busy: string; done: string }> = {
  approve: { button: 'Approve, make profile live', title: 'Approve this vendor?', confirm: 'Approve vendor', busy: 'Approving…', done: 'Vendor approved. The profile is live.' },
  hold: { button: 'Put on hold', title: 'Put this vendor on hold?', confirm: 'Put vendor on hold', busy: 'Holding…', done: 'Vendor put on hold.' },
  reject: { button: 'Reject', title: 'Reject this vendor?', confirm: 'Reject vendor', busy: 'Rejecting…', done: 'Vendor rejected. They can fix and resubmit.' },
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
          {decisions.includes('approve') ? (
            <button type="button" className="btn btn-primary" onClick={() => setOpen('approve')}>
              {DECISION_COPY.approve.button}
            </button>
          ) : null}
          {/* Destructive choices sit apart from Approve. */}
          {decisions.some((d) => d !== 'approve') ? (
            <div className="btn-row" style={{ marginTop: decisions.includes('approve') ? '0.75rem' : 0 }}>
              {decisions
                .filter((d) => d !== 'approve')
                .map((d) => (
                  <button key={d} type="button" className="btn btn-danger-outline" onClick={() => setOpen(d)}>
                    {DECISION_COPY[d].button}
                  </button>
                ))}
            </div>
          ) : null}
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
                <b>{v.businessName}</b> is hidden from customers until approved again. Requests waiting for a reply or for
                payment are closed and those customers are told. Confirmed bookings stay.
              </p>
            ) : (
              <p>
                <b>{v.businessName}</b> goes back to editing. Say clearly what to fix.
              </p>
            )
          }
          confirmLabel={DECISION_COPY[open].confirm}
          busyLabel={DECISION_COPY[open].busy}
          tone={open === 'approve' ? 'primary' : 'danger'}
          input={
            open === 'approve'
              ? undefined
              : { label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.vendor, presets: VENDOR_REJECT_PRESETS, multiline: true }
          }
          onConfirm={(reason) => api.post(`/v1/admin/vendors/${v.id}/${open}`, open === 'approve' ? {} : { reason })}
          successMessage={(result) => closedBookingsMessage(DECISION_COPY[open].done, result)}
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
