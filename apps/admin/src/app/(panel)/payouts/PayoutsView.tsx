'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, formatDay, rupees, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { AdminPayout } from '@/lib/admin-types';
import { BANK_STATUS, canHoldPayout, canMarkPaid, pageFrom, PAYOUT_STATUS, PAYOUT_STATUSES, shortId } from '@/lib/labels';
import { VendorBank } from '../vendors/[id]/VendorBank';
import { can, canView } from '@/lib/roles';
import { REASON_LIMITS, REFERENCE_LIMITS } from '@/lib/validate';

type Dialog = { kind: 'paid' | 'hold'; payout: AdminPayout };

export function PayoutsView() {
  const { session } = useShell();
  const role = session.admin.role;
  const { params, hrefWith, set } = useUrlState();
  const status = PAYOUT_STATUSES.find((s) => s === params.get('status')) ?? '';
  const due = params.get('due') === 'true';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminPayout>>('/v1/admin/payouts', { status, due: due ? 'true' : undefined, page });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [bankFor, setBankFor] = useState<{ vendorId: string; vendorName: string } | null>(null);
  const manage = can(role, 'payout.manage');

  return (
    <div className="page">
      <PageHead title="Payouts" subtitle="Vendor share of each advance, by release time.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="note">
        <span>
          <b>Payouts are sent manually for now.</b> Transfer the amount to the vendor’s bank account from the EventSeva bank, then press
          “Mark paid” and enter the bank UTR / reference. The vendor is notified with that reference. Automatic Razorpay transfers will
          replace this later.
        </span>
      </div>

      <div className="box filters">
        <div className="field">
          <label htmlFor="payout-status">Status</label>
          <select id="payout-status" className="select" value={status} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {PAYOUT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYOUT_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={due} onChange={(e) => set({ due: e.target.checked || null })} />
          Due now (release time has passed)
        </label>
      </div>

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="No payouts found">{status || due ? 'Nothing matches these filters.' : 'No payouts yet.'}</EmptyState>}
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Event date</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Release after</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reference</th>
                    {manage ? <th scope="col">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="nowrap">
                        {canView(role, 'bookings') ? (
                          <Link href={`/bookings/${p.bookingId}`} className="mono">
                            EV-{shortId(p.bookingId)}
                          </Link>
                        ) : (
                          <span className="mono">EV-{shortId(p.bookingId)}</span>
                        )}
                      </td>
                      <td>
                        <span className="cell-main">{p.vendorName}</span>
                        {p.bankStatus ? (
                          <span className="cell-sub">
                            Bank: <StatusPill map={BANK_STATUS} status={p.bankStatus} />
                          </span>
                        ) : (
                          <span className="cell-sub">No bank account added yet</span>
                        )}
                      </td>
                      <td className="nowrap">{formatDay(p.day)}</td>
                      <td className="num">{rupees(p.amountPaise)}</td>
                      <td className="nowrap">{formatDateTime(p.releaseAfter)}</td>
                      <td>
                        <StatusPill map={PAYOUT_STATUS} status={p.status} />
                      </td>
                      <td className="mono">{p.reference ?? '—'}</td>
                      {manage ? (
                        <td>
                          <div className="btn-row" style={{ flexWrap: 'nowrap', gap: '0.5rem' }}>
                            {p.bankStatus ? (
                              <button type="button" className="btn btn-small btn-outline-royal" onClick={() => setBankFor({ vendorId: p.vendorId, vendorName: p.vendorName })}>
                                Bank details
                              </button>
                            ) : null}
                            {canHoldPayout(p.status) ? (
                              <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: 'hold', payout: p })}>
                                Hold
                              </button>
                            ) : null}
                            {canMarkPaid(p.status) ? (
                              <button type="button" className="btn btn-small btn-primary" onClick={() => setDialog({ kind: 'paid', payout: p })}>
                                Mark paid
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
            {bankFor ? (
              <div className="stack">
                <p className="small muted">
                  Bank details for <b>{bankFor.vendorName}</b> ·{' '}
                  <button type="button" className="btn btn-small" onClick={() => setBankFor(null)}>
                    Close
                  </button>
                </p>
                <VendorBank key={bankFor.vendorId} vendorId={bankFor.vendorId} businessName={bankFor.vendorName} />
              </div>
            ) : null}
          </>
        )}
      </QueryView>

      {dialog?.kind === 'paid' ? (
        <ActionDialog
          title="Mark payout as paid?"
          description={
            <p>
              Only after the bank transfer of <b>{rupees(dialog.payout.amountPaise)}</b> to <b>{dialog.payout.vendorName}</b> has gone
              through. The vendor gets a notification with this reference.
            </p>
          }
          confirmLabel="Mark paid"
          input={{
            label: 'Bank UTR / reference',
            what: 'Reference',
            placeholder: 'e.g. UTR 402912345678',
            limits: REFERENCE_LIMITS,
            hint: 'As shown in the bank statement.',
          }}
          onConfirm={(reference) => api.post(`/v1/admin/payouts/${dialog.payout.id}/mark-paid`, { reference })}
          successMessage="Payout marked as paid."
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
      {dialog?.kind === 'hold' ? (
        <ActionDialog
          title="Hold this payout?"
          description={
            <p>
              <b>{rupees(dialog.payout.amountPaise)}</b> to <b>{dialog.payout.vendorName}</b> will not be released until it is marked paid.
            </p>
          }
          confirmLabel="Hold payout"
          tone="danger"
          input={{
            label: 'Reason (for the audit log)',
            limits: REASON_LIMITS.standard,
            presets: ['Open complaint on this booking', 'Bank details to verify'],
          }}
          onConfirm={(reason) => api.post(`/v1/admin/payouts/${dialog.payout.id}/hold`, { reason })}
          successMessage="Payout put on hold."
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
