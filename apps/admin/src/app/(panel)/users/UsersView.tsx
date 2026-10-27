'use client';
import Link from 'next/link';
import { memo, useState } from 'react';
import { formatDateTime, formatPhone, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { SearchBox } from '@/components/SearchBox';
import { CsvDownload } from '@/components/CsvDownload';
import { useShell } from '@/components/ShellContext';
import { EmptyAction, EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { AdminUser } from '@/lib/admin-types';
import { ON_OFF, pageFrom, VENDOR_STATUS } from '@/lib/labels';
import { can, canView, type AdminRole } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';
import { closedBookingsMessage } from '@/lib/closed-bookings';

type Dialog = { kind: 'block' | 'unblock'; user: AdminUser };

const colsFor = (manage: boolean): Col[] => [
  { label: 'Name' },
  { label: 'Phone' },
  { label: 'Vendor' },
  { label: 'Bookings', num: true },
  { label: 'Joined' },
  { label: 'Status' },
  ...(manage ? [{ label: 'Action' }] : []),
];

export function UsersView() {
  const { session } = useShell();
  const role = session.admin.role;
  const { params, hrefWith, set } = useUrlState();
  const q = params.get('q') ?? '';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminUser>>('/v1/admin/users', { q, page });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const manage = can(role, 'user.block');

  return (
    <div className="page">
      <PageHead title="Users" subtitle="Customers and vendors, newest first.">
        <RefreshingHint show={state.refreshing} />
        <CsvDownload kind="users" hint="By the date they joined. Dates are optional and inclusive." />
      </PageHead>

      <div className="box filters">
        <SearchBox initial={q} placeholder="Phone number or name" onSearch={(value, typing) => set({ q: value || null }, { replace: typing })} />
      </div>

      <p className="note">
        <span>
          Blocking logs the user out on every device at once and stops them from logging in again until unblocked.
        </span>
      </p>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={colsFor(manage)} label="Loading users…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="No users found" action={q ? <EmptyAction href="/users">Clear search</EmptyAction> : null}>
            {q ? `Nobody matches “${q}”. Search by the last digits of the phone number or part of the name.` : 'No users yet.'}
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <UserTable items={data.items} role={role} manage={manage} onAction={setDialog} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>

      {dialog?.kind === 'block' ? (
        <ActionDialog
          title="Block this user?"
          description={
            <>
              <p>
                <b>{dialog.user.name ?? 'No name'}</b> · {formatPhone(dialog.user.phone)}
              </p>
              <p>They are logged out everywhere right away and cannot log in until unblocked.</p>
              {dialog.user.vendorId ? (
                <p>Their vendor profile is put on hold and its waiting requests are closed. Unblocking does not make it live again.</p>
              ) : null}
            </>
          }
          confirmLabel="Block user"
          busyLabel="Blocking…"
          tone="danger"
          input={{
            label: 'Reason (for the audit log)',
            limits: REASON_LIMITS.standard,
            presets: ['Abusive behaviour', 'Fake bookings', 'Fraud or spam'],
          }}
          onConfirm={(reason) => api.post(`/v1/admin/users/${dialog.user.id}/block`, { reason })}
          successMessage={(result) => closedBookingsMessage('User blocked and logged out everywhere.', result)}
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
      {dialog?.kind === 'unblock' ? (
        <ActionDialog
          title="Unblock this user?"
          description={
            <p>
              <b>{dialog.user.name ?? 'No name'}</b> · {formatPhone(dialog.user.phone)} can log in again.
            </p>
          }
          confirmLabel="Unblock user"
          busyLabel="Unblocking…"
          onConfirm={() => api.post(`/v1/admin/users/${dialog.user.id}/unblock`)}
          successMessage="User unblocked."
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}

const UserTable = memo(function UserTable({
  items,
  role,
  manage,
  onAction,
}: {
  items: AdminUser[];
  role: AdminRole;
  manage: boolean;
  onAction: (dialog: Dialog) => void;
}) {
  const vendorLinks = canView(role, 'vendors');
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={colsFor(manage)} />
        <tbody>
          {items.map((u) => (
            <tr key={u.id}>
              <td>
                <span className="cell-main">{u.name ?? 'No name'}</span>
                <span className="cell-sub">Language: {u.language === 'hi' ? 'Hindi' : 'English'}</span>
              </td>
              <td className="nowrap">{formatPhone(u.phone)}</td>
              <td>
                {u.vendorId ? (
                  <span className="stack-sm" style={{ gap: '0.25rem' }}>
                    {vendorLinks ? <Link href={`/vendors/${u.vendorId}`}>{u.vendorName}</Link> : u.vendorName}
                    {u.vendorStatus ? <StatusPill map={VENDOR_STATUS} status={u.vendorStatus} /> : null}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="num">{u.bookingCount}</td>
              <td className="nowrap">{formatDateTime(u.createdAt)}</td>
              <td>
                <StatusPill map={ON_OFF} status={u.isBlocked ? 'blocked' : 'active'} />
              </td>
              {manage ? (
                <td>
                  {u.isBlocked ? (
                    <button type="button" className="btn btn-small" onClick={() => onAction({ kind: 'unblock', user: u })} aria-label={`Unblock ${u.name ?? formatPhone(u.phone)}`}>
                      Unblock
                    </button>
                  ) : (
                    <button type="button" className="btn btn-small btn-danger-outline" onClick={() => onAction({ kind: 'block', user: u })} aria-label={`Block ${u.name ?? formatPhone(u.phone)}`}>
                      Block
                    </button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
