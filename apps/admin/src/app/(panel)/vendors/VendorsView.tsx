'use client';
import Link from 'next/link';
import { memo, useMemo } from 'react';
import { formatDateTime, formatPhone, type Category, type Paged, type VendorStatus } from '@eventseva/app-shared';
import { CsvDownload } from '@/components/CsvDownload';
import { useShell } from '@/components/ShellContext';
import { EmptyAction, EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, TabLinks, type Col } from '@/components/ui';
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

const EMPTY: Record<VendorStatus, { text: string; action?: { href: string; label: string } }> = {
  pending: { text: 'No vendors are waiting for verification.', action: { href: '/vendors?status=approved', label: 'See approved vendors →' } },
  approved: { text: 'No approved vendors yet.', action: { href: '/vendors', label: 'Open the verification queue →' } },
  rejected: { text: 'No rejected vendors.', action: { href: '/vendors', label: 'Back to pending →' } },
  on_hold: { text: 'No vendors on hold.', action: { href: '/vendors', label: 'Back to pending →' } },
  draft: { text: 'No vendors are still filling in their profile.', action: { href: '/vendors', label: 'Back to pending →' } },
};

const colsFor = (status: VendorStatus): Col[] => [
  { label: 'Business' },
  { label: 'Category' },
  { label: 'Area' },
  { label: 'Owner phone' },
  { label: 'Services · packages', num: true },
  { label: status === 'pending' ? 'Waiting' : 'Created' },
  { label: 'Status' },
  { label: 'Open', hidden: true },
];

export function VendorsView() {
  const { params, hrefWith } = useUrlState();
  const { counts } = useShell();
  const status = (TABS.find((t) => t.status === params.get('status'))?.status ?? 'pending') as VendorStatus;
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminVendorRow>>('/v1/admin/vendors', { status, page });
  // The list only has the category slug; the public catalog gives its English name.
  const categories = useApiQuery<{ items: Category[] }>('/v1/categories', {}, false);
  const names = useMemo(() => new Map((categories.data?.items ?? []).map((c) => [c.slug, c.name])), [categories.data]);
  const cols = useMemo(() => colsFor(status), [status]);
  const empty = EMPTY[status];

  return (
    <div className="page">
      <PageHead
        title="Vendors"
        subtitle={status === 'pending' ? 'Verification queue, oldest first, so nobody waits longest.' : 'Newest first.'}
      >
        <RefreshingHint show={state.refreshing} />
        <CsvDownload kind="vendors" hint="By the date the profile was created. Dates are optional and inclusive." />
      </PageHead>

      <TabLinks
        label="Vendor status"
        current={status}
        tabs={TABS.map((t) => ({
          key: t.status,
          label: t.label,
          href: hrefWith({ status: t.status === 'pending' ? null : t.status }),
          count: t.status === 'pending' ? counts?.pendingVendors : undefined,
        }))}
      />

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={cols} label="Loading vendors…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="Nothing here" icon={status === 'pending' ? '✓' : '∅'} action={empty.action ? <EmptyAction href={empty.action.href}>{empty.action.label}</EmptyAction> : null}>
            {empty.text}
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <VendorTable items={data.items} status={status} cols={cols} names={names} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </div>
  );
}

const VendorTable = memo(function VendorTable({
  items,
  status,
  cols,
  names,
}: {
  items: AdminVendorRow[];
  status: VendorStatus;
  cols: Col[];
  names: Map<string, string>;
}) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={cols} />
        <tbody>
          {items.map((v) => (
            <tr key={v.id}>
              <td>
                <Link href={`/vendors/${v.id}`} className="cell-main">
                  {v.businessName}
                </Link>
              </td>
              <td>{names.get(v.category) ?? humanize(v.category)}</td>
              <td>
                {v.area ?? '—'}
                <span className="cell-sub">{v.city}</span>
              </td>
              <td className="nowrap">{formatPhone(v.phone)}</td>
              <td className="num">
                {v.serviceCount} · {v.packageCount}
              </td>
              <td className="nowrap">{status === 'pending' ? waitingFor(v.createdAt) : formatDateTime(v.createdAt)}</td>
              <td>
                <StatusPill map={VENDOR_STATUS} status={v.status} />
              </td>
              <td>
                <Link href={`/vendors/${v.id}`} aria-label={`${status === 'pending' ? 'Review' : 'Open'} ${v.businessName}`}>
                  {status === 'pending' ? 'Review →' : 'Open →'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
