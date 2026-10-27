'use client';
import Link from 'next/link';
import { memo } from 'react';
import { formatDay, formatPhone, rupees, type Paged } from '@eventseva/app-shared';
import { BOOKING_STATUSES } from '@eventseva/core';
import { SearchBox } from '@/components/SearchBox';
import { CsvDownload } from '@/components/CsvDownload';
import { ClearFilters, EmptyAction, EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import type { AdminBookingRow } from '@/lib/admin-types';
import { BOOKING_STATUS, pageFrom, shortId, SLOT_LABELS } from '@/lib/labels';

const COLS: Col[] = [
  { label: 'ID' },
  { label: 'Customer' },
  { label: 'Vendor' },
  { label: 'Event' },
  { label: 'Event date' },
  { label: 'Amount', num: true },
  { label: 'Advance', num: true },
  { label: 'Status' },
  { label: 'Open', hidden: true },
];

export function BookingsView() {
  const { params, hrefWith, set } = useUrlState();
  const status = BOOKING_STATUSES.find((s) => s === params.get('status')) ?? '';
  const q = params.get('q') ?? '';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminBookingRow>>('/v1/admin/bookings', { status, q, page });
  const filtered = Boolean(q || status);

  return (
    <div className="page">
      <PageHead title="Bookings" subtitle="Newest first.">
        <RefreshingHint show={state.refreshing} />
        <CsvDownload kind="bookings" hint="By event date. Dates are optional and inclusive." />
      </PageHead>

      <div className="box filters">
        <SearchBox
          initial={q}
          placeholder="Vendor name, customer phone or full booking ID"
          onSearch={(value, typing) => set({ q: value || null }, { replace: typing })}
        />
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" className="select" value={status} data-active={status ? 'true' : undefined} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
        <ClearFilters show={filtered} onClear={() => set({ q: null, status: null })} />
      </div>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} label="Loading bookings…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="No bookings found" action={filtered ? <EmptyAction href="/bookings">Clear search and status</EmptyAction> : null}>
            {filtered ? 'Nothing matches this search or status.' : 'No bookings yet. They appear here as soon as a customer sends a request.'}
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <BookingTable items={data.items} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </div>
  );
}

const BookingTable = memo(function BookingTable({ items }: { items: AdminBookingRow[] }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={COLS} />
        <tbody>
          {items.map((b) => (
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
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
