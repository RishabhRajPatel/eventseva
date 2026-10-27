'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, rupees } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { useShell } from '@/components/ShellContext';
import { ClearFilters, EmptyAction, EmptyState, PageHead, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { canRetryRefund, REFUND_STATUS, REFUND_STATUSES, type AdminRefund } from '@/lib/disputes';
import { shortId } from '@/lib/labels';
import { can } from '@/lib/roles';

const colsFor = (manage: boolean): Col[] => [
  { label: 'Booking' },
  { label: 'Amount', num: true },
  { label: 'Reason' },
  { label: 'Status' },
  { label: 'Razorpay' },
  { label: 'Created' },
  ...(manage ? [{ label: 'Action' }] : []),
];

export function RefundsView() {
  const { session } = useShell();
  const { params, set } = useUrlState();
  const status = REFUND_STATUSES.find((s) => s === params.get('status')) ?? '';
  const state = useApiQuery<{ items: AdminRefund[] }>('/v1/admin/refunds', { status });
  const [retrying, setRetrying] = useState<AdminRefund | null>(null);
  const manage = can(session.admin.role, 'booking.refund');

  return (
    <div className="page">
      <PageHead title="Refunds" subtitle="Every refund with its Razorpay result, newest first (last 200).">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="box filters">
        <div className="field">
          <label htmlFor="refund-status">Status</label>
          <select id="refund-status" className="select" value={status} data-active={status ? 'true' : undefined} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {REFUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REFUND_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
        <ClearFilters show={Boolean(status)} onClear={() => set({ status: null })} />
      </div>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={colsFor(manage)} label="Loading refunds…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="No refunds found" action={status ? <EmptyAction href="/refunds">Show all refunds</EmptyAction> : null}>
            {status ? 'Nothing matches this status.' : 'No refunds yet.'}
          </EmptyState>
        }
      >
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={colsFor(manage)} />
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <Link href={`/bookings/${r.bookingId}`} className="mono">
                        EV-{shortId(r.bookingId)}
                      </Link>
                    </td>
                    <td className="num">{rupees(r.amountPaise)}</td>
                    <td>{r.reason}</td>
                    <td>
                      <StatusPill map={REFUND_STATUS} status={r.status} />
                      {r.lastError ? <span className="cell-sub">{r.lastError}</span> : null}
                    </td>
                    <td className="mono">{r.razorpayRefundId ?? '—'}</td>
                    <td className="nowrap">
                      {formatDateTime(r.createdAt)}
                      {r.processedAt ? <span className="cell-sub">Reached {formatDateTime(r.processedAt)}</span> : null}
                    </td>
                    {manage ? (
                      <td>
                        {canRetryRefund(r) ? (
                          <button type="button" className="btn btn-small btn-primary" onClick={() => setRetrying(r)} aria-label={`Retry refund of ${rupees(r.amountPaise)}`}>
                            Retry
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      {retrying ? (
        <ActionDialog
          title="Send this refund again?"
          description={
            <p>
              Razorpay could not complete the refund of <b>{rupees(retrying.amountPaise)}</b>
              {retrying.lastError ? ` (“${retrying.lastError}”)` : ''}. A new refund for the same amount is sent to the same payment. This can be
              done once.
            </p>
          }
          confirmLabel={`Retry ${rupees(retrying.amountPaise)}`}
          busyLabel="Sending…"
          onConfirm={() => api.post(`/v1/admin/refunds/${retrying.id}/retry`)}
          successMessage="Refund sent again. Its result shows up here."
          onClose={() => setRetrying(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
