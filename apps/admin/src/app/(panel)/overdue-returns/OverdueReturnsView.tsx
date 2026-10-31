'use client';
import Link from 'next/link';
import { formatDateTime, rupees } from '@eventseva/app-shared';
import { EmptyState, Fact, PageHead, QueryView, RefreshingHint, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { OverdueReturn } from '@/lib/admin-types';
import { shortId } from '@/lib/labels';

const COLS: Col[] = [
  { label: 'Booking' },
  { label: 'What' },
  { label: 'Vendor' },
  { label: 'Customer' },
  { label: 'Due back' },
  { label: 'Late', num: true },
  { label: 'Deposit held', num: true },
];

const KIND = { rental: 'Rental', transport: 'Vehicle' } as const;

/** How late is late enough to worry: a week out of someone's stock is a different problem to a day. */
const tone = (days: number) => (days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'neutral');

/**
 * Rentals and vehicles that should already be back. Both sides are reminded once a day by the
 * sweep; this is for the ones that need a phone call.
 */
export function OverdueReturnsView() {
  const state = useApiQuery<{ items: OverdueReturn[]; heldPaise: number }>('/v1/admin/overdue-returns');

  return (
    <div className="page">
      <PageHead
        title="Overdue returns"
        subtitle="Bookings whose return time has passed and that the vendor has not closed. Until one is closed the stock cannot be re-let and the customer’s deposit stays held. Both sides are reminded once a day automatically."
      >
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} rows={4} label="Loading overdue returns…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="Nothing is late">Every rental and vehicle is either still within its time or already closed.</EmptyState>}
      >
        {(data) => (
          <>
            <div className="facts">
              <Fact label="Late returns">{data.items.length}</Fact>
              <Fact label="Deposits held by them">{rupees(data.heldPaise)}</Fact>
              <Fact label="Longest overdue">{data.items.length ? `${data.items[0].daysLate} days` : '—'}</Fact>
            </div>

            <div className="table-wrap">
              <table className="tbl">
                <TableHead cols={COLS} />
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">
                        <Link href={`/bookings/${r.id}`} className="mono">
                          EV-{shortId(r.id)}
                        </Link>
                      </td>
                      <td>
                        {KIND[r.bookingType]}
                        <span className="cell-sub">{r.fulfilment.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <Link href={`/vendors/${r.vendorId}`}>{r.vendorName}</Link>
                      </td>
                      <td>
                        <span className="cell-main">{r.customerName ?? 'No name'}</span>
                        <a className="cell-sub" href={`tel:${r.customerPhone}`}>
                          {r.customerPhone}
                        </a>
                      </td>
                      <td className="nowrap">
                        {formatDateTime(r.returnDueAt)}
                        <span className="cell-sub">{r.remindedAt ? `Reminded ${formatDateTime(r.remindedAt)}` : 'Not reminded yet'}</span>
                      </td>
                      <td className="num">
                        <span className={`pill tone-${tone(r.daysLate)}`}>{r.daysLate === 1 ? '1 day' : `${r.daysLate} days`}</span>
                      </td>
                      <td className="num">{r.depositPaise ? rupees(r.depositPaise) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryView>
    </div>
  );
}
