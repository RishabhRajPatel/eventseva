'use client';
/* eslint-disable @next/next/no-img-element -- Cloudinary already sizes and formats these URLs. */
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, cardImage, formatDateTime, rupees, type RentalView, type TripView } from '@eventseva/app-shared';
import { FormDialog } from '@/components/dialogs';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api, cloudName } from '@/lib/api';
import { chargeKind, DECISION_NOTE, decisionErrors, type DisputedCharge, type Disputes } from '@/lib/disputes';
import { shortId } from '@/lib/labels';
import { rupeesToPaise } from '@/lib/money';
import { can, canView } from '@/lib/roles';

const colsFor = (manage: boolean): Col[] => [
  { label: 'Booking' },
  { label: 'Vendor' },
  { label: 'Charge' },
  { label: 'Amount', num: true },
  { label: 'Customer says' },
  { label: 'Raised' },
  ...(manage ? [{ label: 'Action' }] : []),
];

export function DisputesView() {
  const { session } = useShell();
  const role = session.admin.role;
  const state = useApiQuery<Disputes>('/v1/admin/disputes');
  const [deciding, setDeciding] = useState<DisputedCharge | null>(null);
  const manage = can(role, 'charge.resolve');
  const bookingLinks = canView(role, 'bookings');
  const bookingRef = (id: string) =>
    bookingLinks ? (
      <Link href={`/bookings/${id}`} className="mono">
        EV-{shortId(id)}
      </Link>
    ) : (
      <span className="mono">EV-{shortId(id)}</span>
    );

  return (
    <div className="page">
      <PageHead title="Disputes" subtitle="Rental and car charges the customer did not agree to, oldest first.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="note">
        <span>
          <b>The deposit stays on hold until every charge is decided.</b> Look at the vendor’s return photos and counts, then keep the charge, lower
          it, or enter 0 to waive it. The decision cannot raise a charge. What is kept is paid to the vendor; the rest of the deposit is refunded,
          and anything above the deposit is added to the customer’s balance.
        </span>
      </div>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={colsFor(manage)} label="Loading disputes…" />}
        isEmpty={(d) => d.charges.length === 0 && d.inspections.length === 0}
        empty={<EmptyState title="No open disputes">Charges the customer disputes show up here.</EmptyState>}
      >
        {(data) => (
          <>
            {data.charges.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <TableHead cols={colsFor(manage)} />
                  <tbody>
                    {data.charges.map((c) => (
                      <tr key={c.id}>
                        <td className="nowrap">{bookingRef(c.bookingId)}</td>
                        <td>
                          <span className="cell-main">{c.businessName}</span>
                          <span className="cell-sub">{c.bookingType === 'transport' ? 'Car trip' : 'Rental'}</span>
                        </td>
                        <td>
                          <span className="cell-main">{chargeKind(c.kind)}</span>
                          <span className="cell-sub">{c.description}</span>
                        </td>
                        <td className="num">{rupees(c.amountPaise)}</td>
                        <td>{c.customerNote ?? '—'}</td>
                        <td className="nowrap">{formatDateTime(c.createdAt)}</td>
                        {manage ? (
                          <td>
                            <button type="button" className="btn btn-small btn-primary" onClick={() => setDeciding(c)} aria-label={`Decide charge ${c.description}`}>
                              Decide
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {data.inspections.length ? (
              <div className="stack">
                <h2>Disputed car inspections</h2>
                <p className="small muted">The customer disagrees with the vendor’s handover or return readings. Call both sides; charges based on them are listed above.</p>
                <ul className="stack">
                  {data.inspections.map((i) => (
                    <li key={`${i.bookingId}-${i.phase}`} className="box">
                      <p>
                        {bookingRef(i.bookingId)} · <b>{i.businessName}</b> · {i.phase === 'handover' ? 'Handover' : 'Return'} ·{' '}
                        {formatDateTime(i.disputedAt)}
                      </p>
                      {i.readings ? <p className="small">Vendor recorded: {readingsText(i.readings)}</p> : null}
                      {i.notes ? <p className="small">Vendor note: {i.notes}</p> : null}
                      <p className="small">Customer says: {i.customerNote ?? '—'}</p>
                      <Photos ids={i.photoIds} label={`${i.phase} photo`} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </QueryView>

      {deciding ? <DecideDialog charge={deciding} onClose={() => setDeciding(null)} onDone={state.reload} /> : null}
    </div>
  );
}

function DecideDialog({ charge: c, onClose, onDone }: { charge: DisputedCharge; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(c.amountPaise / 100));
  const [note, setNote] = useState('');
  const errors = decisionErrors({ amount, note }, c.amountPaise);
  const paise = rupeesToPaise(amount);
  const label = errors.amount || paise === null ? 'Save decision' : paise === 0 ? 'Waive charge' : `Keep ${rupees(paise)}`;

  return (
    <FormDialog
      title={`Decide “${c.description}”?`}
      confirmLabel={label}
      busyLabel="Saving…"
      valid={Object.keys(errors).length === 0}
      onConfirm={() => api.post(`/v1/admin/bookings/${c.bookingId}/charges/${c.id}/resolve`, { amountPaise: paise, note: note.trim() })}
      successMessage="Decision saved. Both sides are notified and the deposit is settled once nothing is open."
      describeError={(e) => {
        if (!(e instanceof ApiError)) return null;
        if (e.code === 'CHARGE_ALREADY_ANSWERED') {
          onDone();
          return 'This charge was already decided (or accepted by the customer). The list is refreshed.';
        }
        if (e.code === 'CHARGE_TOO_HIGH') return `A decision cannot raise the charge: at most ${rupees(c.amountPaise)}.`;
        return null;
      }}
      onClose={onClose}
      onDone={onDone}
    >
      {(tried) => (
        <>
          <p>
            <b>{c.businessName}</b> asks for <b>{rupees(c.amountPaise)}</b> ({chargeKind(c.kind)}). The customer says: “{c.customerNote ?? 'no reason given'}”.
          </p>
          <Evidence bookingId={c.bookingId} transport={c.bookingType === 'transport'} />
          <div className="field">
            <label htmlFor="decide-amount">Amount to keep (₹)</label>
            <input
              id="decide-amount"
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={tried && errors.amount ? true : undefined}
              aria-describedby="decide-amount-hint"
              autoFocus
            />
            <span id="decide-amount-hint" className={tried && errors.amount ? 'field-error' : 'hint'}>
              {tried && errors.amount ? errors.amount : `0 waives it. At most ${rupees(c.amountPaise)}.`}
            </span>
          </div>
          <div className="field">
            <label htmlFor="decide-note">Reason (shown to the customer and the vendor)</label>
            <textarea
              id="decide-note"
              className="textarea"
              rows={3}
              maxLength={DECISION_NOTE.max}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={tried && errors.note ? true : undefined}
              aria-describedby="decide-note-hint"
            />
            <span id="decide-note-hint" className={tried && errors.note ? 'field-error' : 'hint'}>
              {tried && errors.note ? errors.note : `${DECISION_NOTE.min}–${DECISION_NOTE.max} characters. Saved in the audit log.`}
            </span>
          </div>
        </>
      )}
    </FormDialog>
  );
}

/** The vendor's counts and photos for the booking, to judge the charge. */
function Evidence({ bookingId, transport }: { bookingId: string; transport: boolean }) {
  const rental = useApiQuery<RentalView>(transport ? null : `/v1/admin/bookings/${bookingId}/rental`);
  const trip = useApiQuery<TripView>(transport ? `/v1/admin/bookings/${bookingId}/trip` : null);
  if (rental.error || trip.error) return <p className="small muted">Could not load the vendor’s records for this booking.</p>;
  if (rental.data) {
    const r = rental.data;
    const back = r.steps.filter((s) => s.phase === 'return');
    return (
      <div className="stack">
        <ul className="small">
          {r.lines
            .filter((l) => l.damagedQty || l.missingQty)
            .map((l) => (
              <li key={l.id}>
                {l.item.name}: delivered {l.deliveredQty}, back {l.returnedQty}, damaged {l.damagedQty}, missing {l.missingQty}
                {l.note ? ` · “${l.note}”` : ''}
              </li>
            ))}
        </ul>
        <p className="small">
          Deposit paid {rupees(r.deposit.paidPaise)}
          {r.dueToVendorPaise ? ` · ${rupees(r.dueToVendorPaise)} of agreed charges is above the deposit` : ''}
        </p>
        {back.map((s, i) => (
          <div key={i}>
            {s.notes ? <p className="small">Vendor note: {s.notes}</p> : null}
            <Photos ids={s.photoIds} label="Return photo" />
          </div>
        ))}
      </div>
    );
  }
  if (trip.data) {
    return (
      <div className="stack">
        {trip.data.inspections.map((i) => (
          <div key={i.phase}>
            <p className="small">
              {i.phase === 'handover' ? 'Handover' : 'Return'}: {readingsText(i.readings)}
              {i.customerAck ? ` · customer ${i.customerAck}` : ''}
            </p>
            <Photos ids={i.photoIds} label={`${i.phase} photo`} />
          </div>
        ))}
        <p className="small">Deposit paid {rupees(trip.data.deposit.paidPaise)}</p>
      </div>
    );
  }
  return <p className="small muted">Loading the vendor’s records…</p>;
}

function Photos({ ids, label }: { ids: string[]; label: string }) {
  if (!ids.length) return <p className="small muted">No photos.</p>;
  return (
    <div className="btn-row">
      {ids.map((id, n) =>
        cloudName ? (
          <a key={id} href={cardImage(cloudName, id, 800, 600)} target="_blank" rel="noreferrer">
            <img src={cardImage(cloudName, id, 120, 90)} alt={`${label} ${n + 1}`} width={120} height={90} loading="lazy" />
          </a>
        ) : (
          <span key={id} className="mono small">
            {id}
          </span>
        ),
      )}
    </div>
  );
}

function readingsText(r: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof r.odometerKm === 'number') parts.push(`odometer ${r.odometerKm} km`);
  if (typeof r.fuelEighths === 'number') parts.push(`fuel ${r.fuelEighths}/8`);
  if (typeof r.km === 'number') parts.push(`${r.km} km driven`);
  return parts.join(', ') || '—';
}
