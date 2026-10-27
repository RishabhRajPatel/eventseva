'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime, formatDay, formatPhone, rupees } from '@eventseva/app-shared';
import { useShell } from '@/components/ShellContext';
import { Fact, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { AdminBooking } from '@/lib/admin-types';
import { BOOKING_STATUS, humanize, PAYMENT_STATUS, PAYOUT_STATUS, REFUND_REASON, REFUND_STATUS, shortId, SLOT_LABELS } from '@/lib/labels';
import { maxRefundablePaise, paidAdvancePaise } from '@/lib/money';
import { can, canView } from '@/lib/roles';

// Finance only, opened on demand: its own chunk.
const RefundDialog = dynamic(() => import('./RefundDialog').then((m) => m.RefundDialog));

export function BookingDetailView() {
  const { id } = useParams<{ id: string }>();
  const state = useApiQuery<AdminBooking>(`/v1/admin/bookings/${id}`);
  return (
    <div className="page">
      <Link href="/bookings" className="small">
        ← Bookings
      </Link>
      <QueryView state={state} notFound="This booking does not exist." loadingLabel="Loading booking…">
        {(b) => <BookingDetail booking={b} refreshing={state.refreshing} reload={state.reload} />}
      </QueryView>
    </div>
  );
}

function BookingDetail({ booking: b, refreshing, reload }: { booking: AdminBooking; refreshing: boolean; reload: () => void }) {
  const { session } = useShell();
  const role = session.admin.role;
  const vendorPayout = b.advancePaise - b.commissionPaise;
  const maxRefund = maxRefundablePaise(b);
  const [refunding, setRefunding] = useState(false);

  return (
    <>
      <div className="page-head">
        <div className="stack-sm">
          <div className="btn-row">
            <h1>Booking EV-{shortId(b.id)}</h1>
            <StatusPill map={BOOKING_STATUS} status={b.status} />
            <RefreshingHint show={refreshing} />
          </div>
          <p className="muted">
            {b.event.title} · {formatDay(b.day, 'en', true)} · {SLOT_LABELS[b.slot] ?? b.slot}
          </p>
          <p className="mono muted">{b.id}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
        <section className="box stack" aria-labelledby="people-title">
          <h2 id="people-title">Customer and vendor</h2>
          <dl className="facts">
            <Fact label="Customer">{b.customer.name ?? 'No name'}</Fact>
            <Fact label="Customer phone">
              <a href={`tel:${b.customer.phone}`}>{formatPhone(b.customer.phone)}</a>
            </Fact>
            <Fact label="Vendor">
              {canView(role, 'vendors') ? <Link href={`/vendors/${b.vendor.id}`}>{b.vendor.businessName}</Link> : b.vendor.businessName}
            </Fact>
            <Fact label="Vendor phone">
              <a href={`tel:${b.vendor.phone}`}>{formatPhone(b.vendor.phone)}</a>
            </Fact>
          </dl>
        </section>

        <section className="box stack" aria-labelledby="event-title">
          <h2 id="event-title">Event</h2>
          <dl className="facts">
            <Fact label="Event">{b.event.title}</Fact>
            <Fact label="Type">{humanize(b.event.eventType)}</Fact>
            <Fact label="Date">{formatDay(b.day, 'en', true)}</Fact>
            <Fact label="Slot">{SLOT_LABELS[b.slot] ?? b.slot}</Fact>
            <Fact label="Quantity">{b.quantity}</Fact>
            <Fact label="Booked on">{formatDateTime(b.createdAt)}</Fact>
          </dl>
          {b.note ? <p className="quote">Customer note: {b.note}</p> : null}
          {b.cancelReason ? (
            <p className="note note-warning">
              <span>
                <b>Reason:</b> {b.cancelReason}
              </span>
            </p>
          ) : null}
        </section>

        <section className="box stack" aria-labelledby="money-title">
          <div className="section-head">
            <h2 id="money-title">Money</h2>
            {can(role, 'booking.refund') ? (
              <button type="button" className="btn btn-small btn-danger-outline" disabled={maxRefund === 0} onClick={() => setRefunding(true)}>
                {maxRefund === 0 ? (paidAdvancePaise(b) ? 'Fully refunded' : 'Nothing paid to refund') : 'Refund'}
              </button>
            ) : null}
          </div>
          <table className="money">
            <tbody>
              <tr>
                <th scope="row">Booking price</th>
                <td>{rupees(b.amountPaise)}</td>
              </tr>
              <tr>
                <th scope="row">Advance paid in the app</th>
                <td>{rupees(b.advancePaise)}</td>
              </tr>
              <tr className="sub">
                <th scope="row">EventSeva commission</th>
                <td>{rupees(b.commissionPaise)}</td>
              </tr>
              <tr className="sub">
                <th scope="row">Payout to vendor</th>
                <td>{rupees(vendorPayout)}</td>
              </tr>
              <tr>
                <th scope="row">Balance paid to vendor at the event</th>
                <td>{rupees(b.amountPaise - b.advancePaise)}</td>
              </tr>
              <tr>
                <th scope="row">Refunded to customer</th>
                <td>{rupees(b.refundPaise)}</td>
              </tr>
              {paidAdvancePaise(b) ? (
                <tr className="sub">
                  <th scope="row">Can still be refunded</th>
                  <td>{rupees(maxRefund)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="box stack" aria-labelledby="payout-title">
          <div className="section-head">
            <h2 id="payout-title">Vendor payout</h2>
            {b.payout && canView(role, 'payouts') ? <Link href={`/payouts?status=${b.payout.status}`}>Payouts</Link> : null}
          </div>
          {b.payout ? (
            <dl className="facts">
              <Fact label="Amount">{rupees(b.payout.amountPaise)}</Fact>
              <Fact label="Status">
                <StatusPill map={PAYOUT_STATUS} status={b.payout.status} />
              </Fact>
              <Fact label="Release after">{formatDateTime(b.payout.releaseAfter)}</Fact>
              <Fact label="Bank reference (UTR)">{b.payout.reference ?? '—'}</Fact>
            </dl>
          ) : (
            <p className="muted">No payout yet. It is created when the advance is paid.</p>
          )}
        </section>
      </div>

      <section className="box stack" aria-labelledby="payments-title">
        <h2 id="payments-title">Payments and refunds</h2>
        {b.payments.length === 0 ? (
          <p className="muted">No payment orders yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl" aria-label="Payments and refunds">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Razorpay order</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Refund</th>
                  <th scope="col">Created</th>
                  <th scope="col">Paid</th>
                </tr>
              </thead>
              <tbody>
                {b.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{humanize(p.type)}</td>
                    <td className="num">{rupees(p.amountPaise)}</td>
                    <td>
                      <StatusPill map={PAYMENT_STATUS} status={p.status} />
                    </td>
                    <td className="mono">{p.orderId ?? '—'}</td>
                    <td className="mono">{p.paymentId ?? '—'}</td>
                    <td className="mono">{p.refundId ?? '—'}</td>
                    <td className="nowrap">{formatDateTime(p.createdAt)}</td>
                    <td className="nowrap">{p.paidAt ? formatDateTime(p.paidAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {b.refunds?.length ? (
        <section className="box stack" aria-labelledby="refunds-title">
          <h2 id="refunds-title">Refund queue</h2>
          <p className="small muted">Refunds go to Razorpay right after the change is saved, and are retried automatically if Razorpay is down.</p>
          <div className="table-wrap">
            <table className="tbl" aria-label="Refund queue">
              <thead>
                <tr>
                  <th scope="col">Why</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Tries
                  </th>
                  <th scope="col">Razorpay refund</th>
                  <th scope="col">Queued</th>
                  <th scope="col">Last problem</th>
                </tr>
              </thead>
              <tbody>
                {b.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{REFUND_REASON[r.reason] ?? humanize(r.reason)}</td>
                    <td className="num">{rupees(r.amountPaise)}</td>
                    <td>
                      <StatusPill map={REFUND_STATUS} status={r.status} />
                    </td>
                    <td className="num">{r.attempts}</td>
                    <td className="mono">{r.refundId ?? '—'}</td>
                    <td className="nowrap">{formatDateTime(r.createdAt)}</td>
                    <td>{r.status === 'sent' ? '—' : (r.lastError ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {refunding ? <RefundDialog booking={b} maxPaise={maxRefund} onClose={() => setRefunding(false)} onDone={reload} /> : null}
    </>
  );
}

