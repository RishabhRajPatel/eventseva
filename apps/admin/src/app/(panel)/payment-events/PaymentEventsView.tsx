'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, rupees } from '@eventseva/app-shared';
import { ClearFilters, EmptyAction, EmptyState, PageHead, QueryView, RefreshingHint, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { PaymentEvent } from '@/lib/admin-types';
import { humanize, shortId } from '@/lib/labels';

const FILTERS = [
  ['problems', 'Problems only'],
  ['failed', 'Failed'],
  ['processed', 'Processed'],
  ['ignored', 'Ignored'],
] as const;

/** Results that mean money arrived but nothing was confirmed: check them in Razorpay. */
const PROBLEM_RESULTS: Record<string, string> = {
  amount_mismatch: 'Amount does not match the order',
  not_captured: 'Payment not captured',
};

const COLS: Col[] = [
  { label: 'Received' },
  { label: 'Event' },
  { label: 'Order / booking' },
  { label: 'Amount', num: true },
  { label: 'Result' },
  { label: 'Tries', num: true },
];

export function PaymentEventsView() {
  const { params, set } = useUrlState();
  const status = FILTERS.find(([v]) => v === params.get('status'))?.[0] ?? '';
  const state = useApiQuery<{ items: PaymentEvent[] }>('/v1/admin/payment-events', { status });
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);

  async function reconcile() {
    setChecking(true);
    setChecked(null);
    try {
      const r = await api.post<{ confirmed: number }>('/v1/admin/payment-events/reconcile');
      setChecked(r.confirmed ? `${r.confirmed} payment${r.confirmed > 1 ? 's' : ''} found paid and confirmed.` : 'No unpaid order was paid at Razorpay.');
      state.reload();
    } catch {
      setChecked('Razorpay did not answer. The automatic check runs again in a few minutes.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="page">
      <PageHead title="Payment events" subtitle="Razorpay webhooks as they arrived, newest first (last 200). Each one runs once; repeats are skipped.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="box filters">
        <div className="field">
          <label htmlFor="event-status">Show</label>
          <select id="event-status" className="select" value={status} data-active={status ? 'true' : undefined} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All events</option>
            {FILTERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <ClearFilters show={Boolean(status)} onClear={() => set({ status: null })} />
        <button type="button" className="btn btn-outline-royal" onClick={() => void reconcile()} disabled={checking}>
          {checking ? 'Asking Razorpay…' : 'Check unpaid orders now'}
        </button>
        {checked ? <p className="small" role="status">{checked}</p> : null}
      </div>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} label="Loading payment events…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title={status === 'problems' ? 'No payment problems' : 'No payment events'} action={status ? <EmptyAction href="/payment-events">Show all events</EmptyAction> : null}>
            {status ? 'Nothing matches this filter.' : 'Razorpay has not sent any webhook yet.'}
          </EmptyState>
        }
      >
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={COLS} />
              <tbody>
                {data.items.map((e) => {
                  const problem = e.status === 'failed' || (e.result !== null && e.result in PROBLEM_RESULTS);
                  return (
                    <tr key={e.id}>
                      <td className="nowrap">{formatDateTime(e.receivedAt)}</td>
                      <td>
                        {e.event}
                        <span className="cell-sub mono">{e.eventId}</span>
                      </td>
                      <td>
                        {e.bookingId ? (
                          <Link href={`/bookings/${e.bookingId}`} className="mono">
                            EV-{shortId(e.bookingId)}
                          </Link>
                        ) : null}
                        <span className="cell-sub mono">{e.orderId ?? '—'}</span>
                      </td>
                      <td className="num">{e.amountPaise === null ? '—' : rupees(e.amountPaise)}</td>
                      <td>
                        <span className={`pill tone-${problem ? 'danger' : e.status === 'ignored' ? 'neutral' : 'success'}`}>{e.status === 'failed' ? 'Failed' : (PROBLEM_RESULTS[e.result ?? ''] ?? humanize(e.result ?? e.status))}</span>
                        {e.lastError ? <span className="cell-sub">{e.lastError}</span> : null}
                      </td>
                      <td className="num">{e.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}
