'use client';
import Link from 'next/link';
import { formatDay, formatPhone, rupees, type Paged } from '@eventseva/app-shared';
import { BOOKING_STATUSES } from '@eventseva/core';
import { SearchBox } from '@/components/SearchBox';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import type { AdminBookingRow } from '@/lib/admin-types';
import { BOOKING_STATUS, pageFrom, shortId, SLOT_LABELS } from '@/lib/labels';

export function BookingsView() {
  const { params, hrefWith, set } = useUrlState();
  const status = BOOKING_STATUSES.find((s) => s === params.get('status')) ?? '';
  const q = params.get('q') ?? '';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminBookingRow>>('/v1/admin/bookings', { status, q, page });

  return (
    <div className="page">
      <PageHead title="Bookings" subtitle="Newest first.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="box filters">
        {/* key: the box starts again from the URL when the search changes elsewhere (back button). */}
        <SearchBox
          key={q}
          initial={q}
          placeholder="Vendor name, customer phone or full booking ID"
          onSearch={(value) => set({ q: value || null })}
        />
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" className="select" value={status} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="No bookings found">{q || status ? 'Try another search or status.' : 'No bookings yet.'}</EmptyState>}
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Event</th>
                    <th scope="col">Event date</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col" className="num">
                      Advance
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => (
                    <tr key={b.id}>
                      <td className="nowrap">
                        <Link href={`/bookings/${b.id}`} className="mono">
                          EV-{shortId(b.id)}
                        </Link>
                      </td>
                      <td>
                        <span className="cell-main">{b.customerName ?? 'No name'}</span>
                        <span className="cell-sub nowrap">{formatPhone(b.customerPhone)}</span>
                      </td>
                      <td>{b.vendorName}</td>
                      <td>{b.eventTitle}</td>
                      <td className="nowrap">
                        {formatDay(b.day)}
                        <span className="cell-sub">{SLOT_LABELS[b.slot] ?? b.slot}</span>
                      </td>
                      <td className="num">{rupees(b.amountPaise)}</td>
                      <td className="num">
                        {rupees(b.advancePaise)}
                        {b.refundPaise ? <span className="cell-sub">Refund {rupees(b.refundPaise)}</span> : null}
                      </td>
                      <td>
                        <StatusPill map={BOOKING_STATUS} status={b.status} />
                      </td>
                      <td>
                        <Link href={`/bookings/${b.id}`} aria-label={`Open booking EV-${shortId(b.id)}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </div>
  );
}
