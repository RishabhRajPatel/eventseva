'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, formatPhone, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { SearchBox } from '@/components/SearchBox';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { AdminUser } from '@/lib/admin-types';
import { pageFrom, VENDOR_STATUS } from '@/lib/labels';
import { can, canView } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';

type Dialog = { kind: 'block' | 'unblock'; user: AdminUser };

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
      </PageHead>

      <div className="box filters">
        <SearchBox key={q} initial={q} placeholder="Phone number or name" onSearch={(value) => set({ q: value || null })} />
      </div>

      <p className="note">
        <span>
          Blocking logs the user out on every device at once and stops them from logging in again until unblocked.
        </span>
      </p>

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="No users found">{q ? `Nobody matches “${q}”.` : 'No users yet.'}</EmptyState>}
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Vendor</th>
                    <th scope="col" className="num">
                      Bookings
                    </th>
                    <th scope="col">Joined</th>
                    <th scope="col">Status</th>
                    {manage ? <th scope="col">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="cell-main">{u.name ?? 'No name'}</span>
                        <span className="cell-sub">Language: {u.language === 'hi' ? 'Hindi' : 'English'}</span>
                      </td>
                      <td className="nowrap">{formatPhone(u.phone)}</td>
                      <td>
                        {u.vendorId ? (
                          <span className="stack-sm" style={{ gap: '0.25rem' }}>
                            {canView(role, 'vendors') ? <Link href={`/vendors/${u.vendorId}`}>{u.vendorName}</Link> : u.vendorName}
                            {u.vendorStatus ? <StatusPill map={VENDOR_STATUS} status={u.vendorStatus} /> : null}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">{u.bookingCount}</td>
                      <td className="nowrap">{formatDateTime(u.createdAt)}</td>
                      <td>{u.isBlocked ? <span className="pill tone-dark">Blocked</span> : <span className="pill tone-success">Active</span>}</td>
                      {manage ? (
                        <td>
                          {u.isBlocked ? (
                            <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: 'unblock', user: u })}>
                              Unblock
                            </button>
                          ) : (
                            <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: 'block', user: u })}>
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
            </>
          }
          confirmLabel="Block user"
          tone="danger"
          input={{
            label: 'Reason (for the audit log)',
            limits: REASON_LIMITS.standard,
            presets: ['Abusive behaviour', 'Fake bookings', 'Fraud or spam'],
          }}
          onConfirm={(reason) => api.post(`/v1/admin/users/${dialog.user.id}/block`, { reason })}
          successMessage="User blocked and logged out everywhere."
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
          confirmLabel="Unblock"
          onConfirm={() => api.post(`/v1/admin/users/${dialog.user.id}/unblock`)}
          successMessage="User unblocked."
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
