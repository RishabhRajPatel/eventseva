'use client';
import Link from 'next/link';
import { formatDateTime, rupees, type Invoice, type RentalCharge, type RentalView, type TripView } from '@eventseva/app-shared';
import { Fact, QueryView } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { AdminBooking } from '@/lib/admin-types';
import { chargeKind } from '@/lib/disputes';
import { humanize } from '@/lib/labels';
import { canView, type AdminRole } from '@/lib/roles';

/** Engine bookings: times, the rental's items or the car trip, extra charges, deposit, and both invoices. */
export function BookingEngine({ booking: b, role }: { booking: AdminBooking; role: AdminRole }) {
  if (b.bookingType === 'slot') return null;
  const invoices = ['confirmed', 'completed'].includes(b.status) && (role === 'super' || role === 'finance' || role === 'support');
  return (
    <>
      <section className="box stack" aria-labelledby="engine-title">
        <h2 id="engine-title">{b.bookingType === 'rental' ? 'Rental' : b.bookingType === 'transport' ? 'Car trip' : 'Service'}</h2>
        <dl className="facts">
          <Fact label="Type">{humanize(b.bookingType)}</Fact>
          {b.startsAt ? <Fact label="From">{formatDateTime(b.startsAt)}</Fact> : null}
          {b.endsAt ? <Fact label="Until">{formatDateTime(b.endsAt)}</Fact> : null}
          {b.fulfilment ? <Fact label="Step">{humanize(b.fulfilment)}</Fact> : null}
          {b.taxPaise ? <Fact label="GST in the price">{rupees(b.taxPaise)}</Fact> : null}
          {b.depositPaise ? <Fact label="Security deposit">{`${rupees(b.depositPaise)}${b.depositSettledAt ? ` · settled ${formatDateTime(b.depositSettledAt)}` : ''}`}</Fact> : null}
        </dl>
        {b.bookingType === 'rental' ? <Rental bookingId={b.id} role={role} /> : null}
        {b.bookingType === 'transport' ? <Trip bookingId={b.id} role={role} /> : null}
      </section>
      {invoices ? <Invoices bookingId={b.id} /> : null}
    </>
  );
}

function Rental({ bookingId, role }: { bookingId: string; role: AdminRole }) {
  const state = useApiQuery<RentalView>(`/v1/admin/bookings/${bookingId}/rental`);
  return (
    <QueryView state={state} loadingLabel="Loading items…">
      {(r) => (
        <div className="stack">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">Booked</th>
                  <th scope="col" className="num">Sent</th>
                  <th scope="col" className="num">Back</th>
                  <th scope="col" className="num">Damaged</th>
                  <th scope="col" className="num">Missing</th>
                  <th scope="col" className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.item.name}</td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{l.dispatchedQty}</td>
                    <td className="num">{l.returnedQty}</td>
                    <td className="num">{l.damagedQty}</td>
                    <td className="num">{l.missingQty}</td>
                    <td className="num">{rupees(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Charges charges={r.charges} role={role} />
          <p className="small">
            Deposit paid {rupees(r.deposit.paidPaise)} of {rupees(r.deposit.requiredPaise)}
            {r.deposit.settledAt ? ` · kept ${rupees(r.deposit.keptPaise)}` : ''}
            {r.balanceDuePaise ? ` · balance still due ${rupees(r.balanceDuePaise)}` : ''}
          </p>
        </div>
      )}
    </QueryView>
  );
}

function Trip({ bookingId, role }: { bookingId: string; role: AdminRole }) {
  const state = useApiQuery<TripView>(`/v1/admin/bookings/${bookingId}/trip`);
  return (
    <QueryView state={state} loadingLabel="Loading trip…">
      {(v) => (
        <div className="stack">
          <dl className="facts">
            <Fact label="Mode">{v.mode === 'self_drive' ? 'Self-drive' : 'With driver'}</Fact>
            {v.vehicle ? <Fact label="Car">{[v.vehicle.name, v.vehicle.registration].filter(Boolean).join(' · ')}</Fact> : null}
            {v.driver ? <Fact label="Driver">{v.driver.name}</Fact> : null}
            {v.route ? <Fact label="Route">{`${v.route.pickup.address} → ${v.route.destination.address}`}</Fact> : null}
          </dl>
          {v.inspections.length ? (
            <ul className="stack-sm">
              {v.inspections.map((i) => (
                <li key={i.phase} className="small">
                  <b>{i.phase === 'handover' ? 'Handover' : 'Return'}</b> {formatDateTime(i.recordedAt)}: odometer {i.readings.odometerKm} km, fuel {i.readings.fuelEighths}/8
                  {i.readings.km !== undefined ? `, ${i.readings.km} km driven` : ''}
                  {i.customerAck ? ` · customer ${i.customerAck}${i.customerNote ? `: “${i.customerNote}”` : ''}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          <Charges charges={v.charges} role={role} />
          <p className="small">
            Deposit paid {rupees(v.deposit.paidPaise)} of {rupees(v.deposit.requiredPaise)}
            {v.deposit.settledAt ? ` · kept ${rupees(v.deposit.keptPaise)}` : ''}
            {v.balanceDuePaise ? ` · balance still due ${rupees(v.balanceDuePaise)}` : ''}
          </p>
        </div>
      )}
    </QueryView>
  );
}

function Charges({ charges, role }: { charges: RentalCharge[]; role: AdminRole }) {
  if (!charges.length) return null;
  const disputed = charges.some((c) => c.status === 'disputed');
  return (
    <div className="stack-sm">
      <p>
        <b>Extra charges</b>
      </p>
      <ul className="stack-sm">
        {charges.map((c) => (
          <li key={c.id} className="small">
            {chargeKind(c.kind)}: {c.description} · {rupees(c.amountPaise)} · {humanize(c.status)}
            {c.decisionNote ? ` (“${c.decisionNote}”)` : ''}
          </li>
        ))}
      </ul>
      {disputed && canView(role, 'disputes') ? (
        <p className="small">
          <Link href="/disputes">Decide the disputed charge →</Link>
        </p>
      ) : null}
    </div>
  );
}

function Invoices({ bookingId }: { bookingId: string }) {
  const state = useApiQuery<{ customer: Invoice; commission: Invoice }>(`/v1/admin/bookings/${bookingId}/invoices`);
  return (
    <section className="box stack" aria-labelledby="invoices-title">
      <h2 id="invoices-title">Invoices</h2>
      <QueryView state={state} loadingLabel="Loading invoices…">
        {(d) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Number</th>
                  <th scope="col">From → to</th>
                  <th scope="col" className="num">Taxable</th>
                  <th scope="col" className="num">GST</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['To the customer', d.customer],
                  ['Commission to the vendor', d.commission],
                ].map(([label, inv]) => {
                  const i = inv as Invoice;
                  return (
                    <tr key={label as string}>
                      <td>
                        {label as string}
                        <span className="cell-sub">{i.title}</span>
                      </td>
                      <td className="mono">{i.number}</td>
                      <td>
                        {i.seller.name} → {i.buyer.name}
                      </td>
                      <td className="num">{rupees(i.taxablePaise)}</td>
                      <td className="num">{rupees(i.cgstPaise + i.sgstPaise)}</td>
                      <td className="num">{rupees(i.totalPaise)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </section>
  );
}
