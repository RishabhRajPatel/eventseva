'use client';
import Link from 'next/link';
import { formatDateTime, formatPhone, type Category, type Paged, type VendorStatus } from '@eventseva/app-shared';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TabLinks } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import type { AdminVendorRow } from '@/lib/admin-types';
import { humanize, pageFrom, VENDOR_STATUS, waitingFor } from '@/lib/labels';

const TABS: { status: VendorStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'on_hold', label: 'On hold' },
  { status: 'draft', label: 'Draft' },
];

const EMPTY: Record<VendorStatus, string> = {
  pending: 'No vendors are waiting for verification.',
  approved: 'No approved vendors yet.',
  rejected: 'No rejected vendors.',
  on_hold: 'No vendors on hold.',
  draft: 'No vendors are still filling in their profile.',
};

export function VendorsView() {
  const { params, hrefWith } = useUrlState();
  const status = (TABS.find((t) => t.status === params.get('status'))?.status ?? 'pending') as VendorStatus;
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminVendorRow>>('/v1/admin/vendors', { status, page });
  // The list only has the category slug; the public catalog gives its English name.
  const categories = useApiQuery<{ items: Category[] }>('/v1/categories', {}, false);
  const categoryName = (slug: string) => categories.data?.items.find((c) => c.slug === slug)?.name ?? humanize(slug);

  return (
    <div className="page">
      <PageHead
        title="Vendors"
        subtitle={status === 'pending' ? 'Verification queue, oldest first, so nobody waits longest.' : 'Newest first.'}
      >
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <TabLinks
        label="Vendor status"
        current={status}
        tabs={TABS.map((t) => ({ key: t.status, label: t.label, href: hrefWith({ status: t.status === 'pending' ? null : t.status }) }))}
      />

      <QueryView state={state} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Nothing here">{EMPTY[status]}</EmptyState>}>
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Category</th>
                    <th scope="col">Area</th>
                    <th scope="col">Owner phone</th>
                    <th scope="col" className="num">
                      Services · packages
                    </th>
                    <th scope="col">{status === 'pending' ? 'Waiting' : 'Created'}</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Link href={`/vendors/${v.id}`} className="cell-main">
                          {v.businessName}
                        </Link>
                      </td>
                      <td>{categoryName(v.category)}</td>
                      <td>
                        {v.area ?? '—'}
                        <span className="cell-sub">{v.city}</span>
                      </td>
                      <td className="nowrap">{formatPhone(v.phone)}</td>
                      <td className="num">
                        {v.serviceCount} · {v.packageCount}
                      </td>
                      <td className="nowrap">
                        {status === 'pending' ? waitingFor(v.createdAt) : formatDateTime(v.createdAt)}
                      </td>
                      <td>
                        <StatusPill map={VENDOR_STATUS} status={v.status} />
                      </td>
                      <td>
                        <Link href={`/vendors/${v.id}`} aria-label={`Open ${v.businessName}`}>
                          {status === 'pending' ? 'Review' : 'Open'}
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
