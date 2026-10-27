'use client';
import dynamic from 'next/dynamic';
import { memo, useCallback, useState } from 'react';
import { formatDateTime, rupees, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { CsvDownload } from '@/components/CsvDownload';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { AdminCoupon, PublicCategory } from '@/lib/admin-types';
import { couponSummary } from '@/lib/coupons';
import { ON_OFF, pageFrom } from '@/lib/labels';
import { can } from '@/lib/roles';

// The create / edit form sits below the table: its own chunk, loaded right after the list.
const formSkeleton = () => <div className="skel-box" aria-hidden="true" style={{ minHeight: '24rem' }} />;
const CreateCoupon = dynamic(() => import('./CouponForms').then((m) => m.CreateCoupon), { loading: formSkeleton });
const EditCoupon = dynamic(() => import('./CouponForms').then((m) => m.EditCoupon), { loading: formSkeleton });

const colsFor = (manage: boolean): Col[] => [
  { label: 'Code' },
  { label: 'Discount' },
  { label: 'Min. booking', num: true },
  { label: 'Category' },
  { label: 'Rules' },
  { label: 'Valid' },
  { label: 'Uses', num: true },
  { label: 'Discount given', num: true },
  { label: 'Active' },
  ...(manage ? [{ label: 'Action' }] : []),
];

const scrollToForm = () =>
  requestAnimationFrame(() => {
    const form = document.getElementById('coupon-form');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form?.querySelector<HTMLElement>('input:not([disabled])')?.focus({ preventScroll: true });
  });

export function CouponsView() {
  const { session } = useShell();
  const manage = can(session.admin.role, 'coupon.manage');
  const { params, hrefWith } = useUrlState();
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminCoupon>>('/v1/admin/coupons', { page });
  const categories = useApiQuery<{ items: PublicCategory[] }>('/v1/categories', {}, false);
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [toggle, setToggle] = useState<AdminCoupon | null>(null);
  const startEdit = useCallback((c: AdminCoupon) => {
    setEditing(c);
    scrollToForm();
  }, [setEditing]);

  return (
    <div className="page">
      <PageHead title="Coupons" subtitle="Discount codes customers add before paying the advance. Active first, newest first.">
        <RefreshingHint show={state.refreshing} />
        <CsvDownload kind="coupons" hint="By the date the coupon was created. Dates are optional and inclusive." />
      </PageHead>

      <p className="note">
        <span>
          <b>EventSeva pays the discount; vendor payouts don’t change.</b> The code and the discount are fixed once created, because customers may
          already hold the code. To change them, deactivate the coupon and make a new one.
        </span>
      </p>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={colsFor(manage)} rows={5} label="Loading coupons…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title={page === 1 ? 'No coupons yet' : 'No more coupons'}
            action={
              manage && page === 1 ? (
                <button type="button" className="btn btn-outline-royal btn-small" onClick={scrollToForm}>
                  Create the first coupon ↓
                </button>
              ) : null
            }
          />
        }
      >
        {(data) => (
          <>
            <CouponTable items={data.items} manage={manage} editingId={editing?.id ?? null} onEdit={startEdit} onToggle={setToggle} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>

      {manage ? (
        editing ? (
          <EditCoupon key={editing.id} coupon={editing} onClose={() => setEditing(null)} onSaved={state.reload} />
        ) : (
          <CreateCoupon categories={categories.data?.items ?? []} categoriesFailed={Boolean(categories.error)} onSaved={state.reload} />
        )
      ) : null}

      {toggle ? (
        <ActionDialog
          title={toggle.isActive ? `Deactivate coupon ${toggle.code}?` : `Activate coupon ${toggle.code}?`}
          description={
            toggle.isActive ? (
              <p>
                Customers can no longer add this code. {toggle.heldCount ? `${toggle.heldCount} unpaid booking(s) holding it keep the discount. ` : ''}
                Bookings that already used it ({toggle.usedCount}) keep their discount.
              </p>
            ) : (
              <p>Customers can add this code again while it is within its dates and uses.</p>
            )
          }
          confirmLabel={toggle.isActive ? 'Deactivate coupon' : 'Activate coupon'}
          busyLabel={toggle.isActive ? 'Deactivating…' : 'Activating…'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/coupons/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? `${toggle.code} deactivated.` : `${toggle.code} is active.`}
          undo={{
            run: () => api.patch(`/v1/admin/coupons/${toggle.id}`, { isActive: toggle.isActive }),
            message: toggle.isActive ? `${toggle.code} is active again.` : `${toggle.code} is inactive again.`,
          }}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}

const CouponTable = memo(function CouponTable({
  items,
  manage,
  editingId,
  onEdit,
  onToggle,
}: {
  items: AdminCoupon[];
  manage: boolean;
  editingId: number | null;
  onEdit: (c: AdminCoupon) => void;
  onToggle: (c: AdminCoupon) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={colsFor(manage)} />
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className={c.isActive ? undefined : 'row-off'} aria-current={c.id === editingId ? 'true' : undefined}>
              <td>
                <span className="cell-main mono">{c.code}</span>
                <span className="cell-sub">{c.titleEn}</span>
                <span className="cell-sub" lang="hi">
                  {c.titleHi}
                </span>
              </td>
              <td className="nowrap">{couponSummary(c, rupees)}</td>
              <td className="num">{c.minAmountPaise ? rupees(c.minAmountPaise) : '—'}</td>
              <td>{c.categoryName ?? 'All'}</td>
              <td>
                <span className="cell-sub">{c.firstBookingOnly ? 'First booking only' : 'Any booking'}</span>
                <span className="cell-sub">{c.isPublic ? 'Shown in the app' : 'Hidden (code only)'}</span>
                <span className="cell-sub">{c.perCustomerLimit === 1 ? 'Once per customer' : `${c.perCustomerLimit}× per customer`}</span>
              </td>
              <td className="nowrap">
                <span className="cell-sub">From {formatDateTime(c.validFrom)}</span>
                <span className="cell-sub">{c.validUntil ? `Until ${formatDateTime(c.validUntil)}` : 'No end date'}</span>
              </td>
              <td className="num nowrap">
                {c.usedCount}
                {c.maxUses ? ` / ${c.maxUses}` : ''}
                {c.heldCount ? <span className="cell-sub">{c.heldCount} held</span> : null}
              </td>
              <td className="num">{rupees(c.discountGivenPaise)}</td>
              <td>
                <StatusPill map={ON_OFF} status={c.isActive ? 'active' : 'inactive'} />
              </td>
              {manage ? (
                <td>
                  <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-small btn-outline-royal"
                      aria-pressed={c.id === editingId}
                      aria-label={`Edit ${c.code}`}
                      onClick={() => onEdit(c)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`btn btn-small ${c.isActive ? 'btn-danger-outline' : 'btn-primary'}`}
                      aria-label={`${c.isActive ? 'Deactivate' : 'Activate'} ${c.code}`}
                      onClick={() => onToggle(c)}
                    >
                      {c.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
