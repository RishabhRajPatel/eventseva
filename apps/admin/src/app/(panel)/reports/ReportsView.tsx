'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDay, rupees } from '@eventseva/app-shared';
import { PageHead, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { paise, statusTotals, validRange, type ReportSummary } from '@/lib/checks';
import { BOOKING_STATUS, humanize } from '@/lib/labels';
import { useShell } from '@/components/ShellContext';
import { canView } from '@/lib/roles';

/** Money and bookings for a period of event days (this month by default), India time. */
export function ReportsView() {
  const { session } = useShell();
  const { params, set } = useUrlState();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const rangeError = validRange(from, to);
  const state = useApiQuery<ReportSummary>(rangeError ? null : '/v1/admin/reports/summary', { from: from || undefined, to: to || undefined });
  // Untouched boxes show the period the server used (this month by default).
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({ from: from || undefined, to: to || undefined });
  const shown = { from: draft.from ?? state.data?.from ?? '', to: draft.to ?? state.data?.to ?? '' };

  return (
    <div className="page">
      <PageHead title="Reports" subtitle="Bookings by their event day (this month by default); payments and refunds by the day they happened.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <form
        className="box filters"
        onSubmit={(e) => {
          e.preventDefault();
          set({ from: shown.from || null, to: shown.to || null });
        }}
      >
        <div className="field">
          <label htmlFor="report-from">From</label>
          <input id="report-from" className="input" type="date" value={shown.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="report-to">To</label>
          <input id="report-to" className="input" type="date" value={shown.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary">
          Show
        </button>
        {rangeError ? <p className="field-error">{rangeError}</p> : null}
      </form>

      <QueryView state={state}>
        {(r) => {
          const m = r.money;
          const cards: [string, number][] = [
            ['Booked value (confirmed + completed)', paise(m.bookedValuePaise)],
            ['EventSeva commission (completed)', paise(m.commissionPaise)],
            ['Advances received', paise(m.advancesPaise)],
            ['Balances received', paise(m.balancesPaise)],
            ['Security deposits received', paise(m.depositsPaise)],
            ['Refunds sent', paise(m.refundsPaise)],
            ['Vendor payouts', paise(m.payoutsPaise)],
          ];
          return (
            <div className="stack">
              <p className="small muted">
                {formatDay(r.from)} – {formatDay(r.to)}
              </p>
              <dl className="facts">
                {cards.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="num">{rupees(value)}</dd>
                  </div>
                ))}
              </dl>
              {m.failedRefunds ? (
                <div className="note note-warning">
                  <span>
                    <b>{m.failedRefunds} refund{m.failedRefunds > 1 ? 's' : ''} failed at Razorpay.</b>{' '}
                    {canView(session.admin.role, 'refunds') ? <Link href="/refunds?status=failed">Open refunds</Link> : 'Ask finance to retry them.'}
                  </span>
                </div>
              ) : null}

              <section className="box stack" aria-labelledby="by-status">
                <h2 id="by-status">Bookings by status</h2>
                {r.byStatus.length === 0 ? <p className="muted">No bookings with an event day in this period.</p> : null}
                <div className="table-wrap" hidden={r.byStatus.length === 0}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">Bookings</th>
                        <th scope="col" className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusTotals(r.byStatus).map((s) => (
                        <tr key={s.status}>
                          <td>{s.status in BOOKING_STATUS ? <StatusPill map={BOOKING_STATUS} status={s.status} /> : humanize(s.status)}</td>
                          <td className="num">{s.bookings}</td>
                          <td className="num">{rupees(s.amountPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="box stack" aria-labelledby="by-category">
                <h2 id="by-category">Confirmed bookings by category</h2>
                {r.byCategory.length ? (
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Category</th>
                          <th scope="col" className="num">Bookings</th>
                          <th scope="col" className="num">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.byCategory.map((cat) => (
                          <tr key={cat.slug}>
                            <td>{cat.name}</td>
                            <td className="num">{cat.bookings}</td>
                            <td className="num">{rupees(paise(cat.amountPaise))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No confirmed bookings in this period.</p>
                )}
              </section>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
