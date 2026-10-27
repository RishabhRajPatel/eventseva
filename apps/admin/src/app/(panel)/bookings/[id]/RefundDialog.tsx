'use client';
import { useState } from 'react';
import { ApiError, rupees } from '@eventseva/app-shared';
import { FormDialog } from '@/components/FormDialog'; // this file is already its own lazy chunk
import { api } from '@/lib/api';
import type { AdminBooking } from '@/lib/admin-types';
import { maxDeductionPaise, paidAdvancePaise, REFUND_REASON, refundFormErrors, rupeesToPaise } from '@/lib/money';

const PAYOUT_OPEN = ['scheduled', 'held', 'failed'];

/** Partial refund of the paid advance (POST /v1/admin/bookings/:id/refund). */
export function RefundDialog({ booking: b, maxPaise, onClose, onDone }: { booking: AdminBooking; maxPaise: number; onClose: () => void; onDone: () => void }) {
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
      title={`Refund ${b.customer.name ?? 'the customer'} for booking EV-${b.id.slice(0, 8).toUpperCase()}?`}
      confirmLabel={paise && !errors.amount ? `Refund ${rupees(paise)}` : 'Refund'}
      busyLabel="Starting refund…"
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
