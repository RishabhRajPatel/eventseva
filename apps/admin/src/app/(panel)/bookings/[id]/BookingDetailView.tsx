'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, formatDateTime, formatDay, formatPhone, rupees } from '@eventseva/app-shared';
import { FormDialog } from '@/components/FormDialog';
import { useShell } from '@/components/ShellContext';
import { Fact, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { AdminBooking } from '@/lib/admin-types';
import { BOOKING_STATUS, humanize, PAYOUT_STATUS, shortId, SLOT_LABELS } from '@/lib/labels';
import { maxDeductionPaise, maxRefundablePaise, paidAdvancePaise, REFUND_REASON, refundFormErrors, rupeesToPaise } from '@/lib/money';
import { can, canView } from '@/lib/roles';

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
              <button type="button" className="btn btn-small btn-outline-royal" disabled={maxRefund === 0} onClick={() => setRefunding(true)}>
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
            <table className="tbl">
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
                      <span className="pill tone-neutral">{humanize(p.status)}</span>
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

      {refunding ? <RefundDialog booking={b} maxPaise={maxRefund} onClose={() => setRefunding(false)} onDone={reload} /> : null}
    </>
  );
}

const PAYOUT_OPEN = ['scheduled', 'held', 'failed'];

/** Partial refund of the paid advance (POST /v1/admin/bookings/:id/refund). */
function RefundDialog({ booking: b, maxPaise, onClose, onDone }: { booking: AdminBooking; maxPaise: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [fromVendor, setFromVendor] = useState(false);
  const payoutSent = b.payout !== null && !PAYOUT_OPEN.includes(b.payout.status);
  const paise = rupeesToPaise(amount);
  const maxFromVendor = maxDeductionPaise(b);
  const errors = refundFormErrors({ amount, reason }, maxPaise);
  if (!errors.amount && fromVendor && paise !== null && paise > maxFromVendor) {
    errors.amount = `At most ${rupees(maxFromVendor)} can come off the vendor's payout. Lower the amount or untick the box below.`;
  }

  return (
    <FormDialog
      title="Refund to the customer"
      confirmLabel={paise && !errors.amount ? `Refund ${rupees(paise)}` : 'Refund'}
      tone="danger"
      valid={Object.keys(errors).length === 0}
      onConfirm={() =>
        api.post(`/v1/admin/bookings/${b.id}/refund`, { amountPaise: rupeesToPaise(amount), reason: reason.trim(), fromVendorPayout: fromVendor })
      }
      successMessage="Refund started. The customer is notified; money reaches them in 5–7 working days."
      describeError={(e) => {
        if (!(e instanceof ApiError)) return null;
        switch (e.code) {
          case 'REFUND_TOO_HIGH':
            onDone();
            return typeof e.details.maxPaise === 'number' ? `Too much: at most ${rupees(e.details.maxPaise)} can still be refunded.` : e.message;
          case 'NOTHING_TO_REFUND':
            onDone();
            return 'No payment has been made for this booking, so there is nothing to refund.';
          case 'DEDUCTION_TOO_HIGH':
            return `${e.message} Lower the amount, or untick “Take it from the vendor’s payout” so EventSeva pays the rest.`;
          case 'PAYOUT_ALREADY_PAID':
            onDone();
            return 'The vendor has already been paid for this booking. Untick “Take it from the vendor’s payout” to refund at EventSeva’s cost.';
          default:
            return null;
        }
      }}
      onClose={onClose}
      onDone={onDone}
    >
      {(tried) => (
        <>
          <p>
            Paid advance {rupees(paidAdvancePaise(b))}, already refunded {rupees(b.refundPaise)}. <b>At most {rupees(maxPaise)}</b> can still be
            refunded.
            {b.payoutDeductionPaise > 0 ? ` ${rupees(b.payoutDeductionPaise)} has already been taken from the vendor's payout.` : ''}
          </p>
          <div className="field">
            <label htmlFor="refund-amount">Amount (₹)</label>
            <input
              id="refund-amount"
              className="input"
              inputMode="decimal"
              placeholder="e.g. 500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={tried && errors.amount ? true : undefined}
              aria-describedby="refund-amount-hint"
              autoFocus
            />
            <span id="refund-amount-hint" className={tried && errors.amount ? 'field-error' : 'hint'}>
              {tried && errors.amount ? errors.amount : 'In rupees. The refund goes back to the card or UPI the customer paid with.'}
            </span>
          </div>
          <div className="field">
            <label htmlFor="refund-reason">Reason (shown to the customer)</label>
            <textarea
              id="refund-reason"
              className="textarea"
              rows={3}
              maxLength={REFUND_REASON.max}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && errors.reason ? true : undefined}
              aria-describedby="refund-reason-hint"
            />
            <span id="refund-reason-hint" className={tried && errors.reason ? 'field-error' : 'hint'}>
              {tried && errors.reason ? errors.reason : `${REFUND_REASON.min}–${REFUND_REASON.max} characters.`}
            </span>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={fromVendor} disabled={payoutSent} onChange={(e) => setFromVendor(e.target.checked)} />
            Take it from the vendor’s payout
          </label>
          <p className="small muted">
            {payoutSent
              ? 'The vendor’s payout has already gone out, so EventSeva pays this refund.'
              : fromVendor
                ? 'The vendor’s payout for this booking is cut by the same amount and the vendor is notified.'
                : 'Unticked: EventSeva pays the refund; the vendor’s payout does not change.'}
          </p>
        </>
      )}
    </FormDialog>
  );
}
