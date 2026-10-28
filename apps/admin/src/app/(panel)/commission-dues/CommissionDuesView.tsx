'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, rupees } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { ClearFilters, EmptyAction, EmptyState, PageHead, QueryView, RefreshingHint, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { CommissionDue } from '@/lib/admin-types';
import { shortId } from '@/lib/labels';

const STATUSES = [
  ['open', 'Open'],
  ['settled', 'Settled'],
  ['waived', 'Waived'],
] as const;

const COLS: Col[] = [{ label: 'Vendor' }, { label: 'Booking' }, { label: 'Commission', num: true }, { label: 'Still owed', num: true }, { label: 'Status' }, { label: 'Since' }, { label: 'Action' }];

/** EventSeva's commission on cash bookings, owed by vendors until a payout covers it or finance settles it. */
export function CommissionDuesView() {
  const { params, set } = useUrlState();
  const status = STATUSES.find(([v]) => v === params.get('status'))?.[0] ?? '';
  const state = useApiQuery<{ items: CommissionDue[] }>('/v1/admin/commission-dues', { status });
  const [acting, setActing] = useState<{ due: CommissionDue; kind: 'settle' | 'waive' } | null>(null);

  return (
    <div className="page">
      <PageHead title="Commission dues" subtitle="Commission on cash bookings. It comes off the vendor’s next online payout by itself; record it here when the vendor pays EventSeva directly.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="box filters">
        <div className="field">
          <label htmlFor="due-status">Status</label>
          <select id="due-status" className="select" value={status} data-active={status ? 'true' : undefined} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All</option>
            {STATUSES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <ClearFilters show={Boolean(status)} onClear={() => set({ status: null })} />
      </div>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} label="Loading commission dues…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="No commission dues" action={status ? <EmptyAction href="/commission-dues">Show all</EmptyAction> : null}>
            {status ? 'Nothing matches this status.' : 'No cash booking has completed yet.'}
          </EmptyState>
        }
      >
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={COLS} />
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/vendors/${d.vendorId}`}>{d.businessName}</Link>
                    </td>
                    <td className="nowrap">
                      <Link href={`/bookings/${d.bookingId}`} className="mono">
                        EV-{shortId(d.bookingId)}
                      </Link>
                    </td>
                    <td className="num">{rupees(d.amountPaise)}</td>
                    <td className="num">{rupees(d.remainingPaise)}</td>
                    <td>
                      <span className={`pill tone-${d.status === 'open' ? 'warning' : d.status === 'settled' ? 'success' : 'neutral'}`}>{STATUSES.find(([v]) => v === d.status)?.[1]}</span>
                      {d.reference ? <span className="cell-sub">{d.reference}</span> : null}
                    </td>
                    <td className="nowrap">
                      {formatDateTime(d.createdAt)}
                      {d.settledAt ? <span className="cell-sub">Closed {formatDateTime(d.settledAt)}</span> : null}
                    </td>
                    <td className="nowrap">
                      {d.status === 'open' ? (
                        <>
                          <button type="button" className="btn btn-small btn-primary" onClick={() => setActing({ due: d, kind: 'settle' })}>
                            Mark paid
                          </button>{' '}
                          <button type="button" className="btn btn-small" onClick={() => setActing({ due: d, kind: 'waive' })}>
                            Waive
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      {acting ? (
        <ActionDialog
          title={acting.kind === 'settle' ? 'Mark this commission as paid?' : 'Waive this commission?'}
          description={
            <p>
              {acting.due.businessName} owes <b>{rupees(acting.due.remainingPaise)}</b> on a cash booking.{' '}
              {acting.kind === 'settle' ? 'Record it once their payment to EventSeva has arrived.' : 'EventSeva will not collect it.'}
            </p>
          }
          input={
            acting.kind === 'settle'
              ? { label: 'UPI or bank reference', what: 'Reference', limits: { min: 3, max: 200 } }
              : { label: 'Why it is waived', what: 'Reason', limits: { min: 3, max: 200 }, multiline: true }
          }
          confirmLabel={acting.kind === 'settle' ? `Mark ${rupees(acting.due.remainingPaise)} paid` : 'Waive'}
          busyLabel="Saving…"
          tone={acting.kind === 'waive' ? 'danger' : 'primary'}
          onConfirm={(text) => api.post(`/v1/admin/commission-dues/${acting.due.id}/${acting.kind}`, { reference: text })}
          successMessage={acting.kind === 'settle' ? 'Marked as paid. The vendor is told.' : 'Waived. The vendor is told.'}
          onClose={() => setActing(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
