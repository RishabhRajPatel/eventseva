'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, formatPhone, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { useShell } from '@/components/ShellContext';
import { EmptyState, Fact, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TabLinks } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { AdminComplaint } from '@/lib/admin-types';
import { COMPLAINT_STATUS, COMPLAINT_STATUSES, pageFrom, shortId, waitingFor, type ComplaintStatus } from '@/lib/labels';
import { can, canView } from '@/lib/roles';
import { RESOLUTION_LIMITS } from '@/lib/validate';
import styles from './complaints.module.css';

export function ComplaintsView() {
  const { params, hrefWith } = useUrlState();
  const status = COMPLAINT_STATUSES.find((s) => s === params.get('status')) ?? 'open';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminComplaint>>('/v1/admin/complaints', { status, page });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHead title="Complaints" subtitle="Oldest first. The person who raised it is notified when it is resolved.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <TabLinks
        label="Complaint status"
        current={status}
        tabs={COMPLAINT_STATUSES.map((s) => ({ key: s, label: COMPLAINT_STATUS[s].label, href: hrefWith({ status: s === 'open' ? null : s }) }))}
      />

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="No complaints here">{status === 'open' ? 'Nothing new to look at.' : 'Nothing in this list.'}</EmptyState>}
      >
        {(data) => {
          // Keep the selection while it is still in the list (it leaves the tab after a status change).
          const selected = data.items.find((c) => c.id === selectedId) ?? data.items[0];
          return (
            <div className={styles.layout}>
              <div className="stack">
                <ul className={styles.list} aria-label="Complaints" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {data.items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={styles.item}
                        aria-current={c.id === selected.id ? 'true' : undefined}
                        onClick={() => setSelectedId(c.id)}
                      >
                        <span className={styles.subject}>{c.subject}</span>
                        <span className="muted">
                          {c.raisedByName ?? formatPhone(c.raisedByPhone)} · {c.raisedByVendor ? 'Vendor' : 'Customer'}
                          {c.bookingId ? ` · EV-${shortId(c.bookingId)}` : ''} · {waitingFor(c.createdAt)} ago
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
              </div>
              <ComplaintDetail key={selected.id} complaint={selected} onDone={state.reload} />
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}

type Change = { to: ComplaintStatus };

function ComplaintDetail({ complaint: c, onDone }: { complaint: AdminComplaint; onDone: () => void }) {
  const { session } = useShell();
  const role = session.admin.role;
  const [change, setChange] = useState<Change | null>(null);
  const manage = can(role, 'complaint.manage');

  return (
    <section className={`box stack ${styles.detail}`} aria-labelledby="complaint-title">
      <div className="section-head">
        <h2 id="complaint-title">{c.subject}</h2>
        <StatusPill map={COMPLAINT_STATUS} status={c.status} />
      </div>

      <dl className="facts">
        <Fact label="Raised by">
          {c.raisedByName ?? 'No name'} <span className="pill tone-info">{c.raisedByVendor ? 'Vendor' : 'Customer'}</span>
        </Fact>
        <Fact label="Phone">
          <a href={`tel:${c.raisedByPhone}`}>{formatPhone(c.raisedByPhone)}</a>
        </Fact>
        <Fact label="Booking">
          {c.bookingId ? (
            canView(role, 'bookings') ? (
              <Link href={`/bookings/${c.bookingId}`}>EV-{shortId(c.bookingId)}</Link>
            ) : (
              `EV-${shortId(c.bookingId)}`
            )
          ) : (
            'Not linked to a booking'
          )}
        </Fact>
        <Fact label="Raised on">{formatDateTime(c.createdAt)}</Fact>
      </dl>

      <p className="quote">{c.details}</p>

      {c.resolution ? (
        <div className="stack-sm">
          <h3>Resolution</h3>
          <p className="quote" style={{ background: 'var(--mint-light)' }}>
            {c.resolution}
          </p>
        </div>
      ) : null}

      {manage ? (
        <div className="btn-row">
          {c.status !== 'resolved' ? (
            <button type="button" className="btn btn-primary" onClick={() => setChange({ to: 'resolved' })}>
              Resolve
            </button>
          ) : null}
          {c.status === 'open' ? (
            <button type="button" className="btn" onClick={() => setChange({ to: 'in_progress' })}>
              Mark in progress
            </button>
          ) : null}
          {c.status !== 'open' ? (
            <button type="button" className="btn" onClick={() => setChange({ to: 'open' })}>
              {c.status === 'resolved' ? 'Reopen' : 'Move back to open'}
            </button>
          ) : null}
        </div>
      ) : null}

      {change?.to === 'resolved' ? (
        <ActionDialog
          title="Resolve this complaint?"
          description={<p>The resolution is sent to {c.raisedByName ?? 'the person who raised it'} as a notification.</p>}
          confirmLabel="Resolve"
          input={{
            label: 'Resolution',
            what: 'Resolution',
            placeholder: 'What was decided and done',
            limits: RESOLUTION_LIMITS,
            multiline: true,
          }}
          onConfirm={(resolution) => api.post(`/v1/admin/complaints/${c.id}`, { status: 'resolved', resolution })}
          successMessage="Complaint resolved."
          onClose={() => setChange(null)}
          onDone={onDone}
        />
      ) : change ? (
        <ActionDialog
          title={change.to === 'in_progress' ? 'Mark as in progress?' : 'Move back to open?'}
          description={<p>“{c.subject}” moves to the {COMPLAINT_STATUS[change.to].label.toLowerCase()} list.</p>}
          confirmLabel={change.to === 'in_progress' ? 'Mark in progress' : 'Move to open'}
          onConfirm={() => api.post(`/v1/admin/complaints/${c.id}`, { status: change.to })}
          successMessage={`Complaint moved to ${COMPLAINT_STATUS[change.to].label.toLowerCase()}.`}
          onClose={() => setChange(null)}
          onDone={onDone}
        />
      ) : null}
    </section>
  );
}
