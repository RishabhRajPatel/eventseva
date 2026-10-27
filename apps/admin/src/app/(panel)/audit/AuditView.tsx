'use client';
import Link from 'next/link';
import { Fragment, memo, useState } from 'react';
import { formatDateTime } from '@eventseva/app-shared';
import { SearchBox } from '@/components/SearchBox';
import { ClearFilters, EmptyAction, EmptyState, PageHead, Pager, QueryView, RefreshingHint, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import type { AuditEntry, AuditPage } from '@/lib/admin-types';
import { auditDiff, auditTargetHref } from '@/lib/audit';
import { humanize, pageFrom, shortId } from '@/lib/labels';
import { isAdminRole, ROLE_LABELS } from '@/lib/roles';
import styles from './audit.module.css';

/** target_type values the API writes (admin_audit_log). */
const TARGET_TYPES = ['alert', 'booking', 'category', 'city', 'complaint', 'coupon', 'document', 'export', 'featured_plan', 'media', 'payout', 'review', 'user', 'vendor'];

const COLS: Col[] = [{ label: 'Time' }, { label: 'Admin' }, { label: 'Action' }, { label: 'Target' }, { label: 'Changes' }];

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Every admin action with what it changed. Newest first, 50 per page. */
export function AuditView() {
  const { params, hrefWith, set } = useUrlState();
  const action = params.get('action') ?? '';
  const targetType = params.get('targetType') ?? '';
  const adminId = params.get('adminId') ?? '';
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<AuditPage>('/v1/admin/audit', {
    action: action || undefined,
    targetType: targetType || undefined,
    adminId: isUuid(adminId) ? adminId : undefined,
    page,
  });
  const admins = state.data?.admins ?? [];
  const filtered = Boolean(action || targetType || adminId);

  return (
    <div className="page">
      <PageHead title="Audit log" subtitle="Every admin action, newest first. Open a row to see what changed.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <div className="box filters">
        <SearchBox
          initial={action}
          label="Action starts with"
          placeholder="e.g. coupon or vendor.feature"
          maxLength={60}
          mono
          onSearch={(value, typing) => set({ action: value || null }, { replace: typing })}
        />
        <div className="field">
          <label htmlFor="audit-target">Target</label>
          <select id="audit-target" className="select" value={targetType} data-active={targetType ? 'true' : undefined} onChange={(e) => set({ targetType: e.target.value || null })}>
            <option value="">All targets</option>
            {[...new Set([...TARGET_TYPES, ...(targetType ? [targetType] : [])])].map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-admin">Admin</label>
          <select id="audit-admin" className="select" value={adminId} data-active={adminId ? 'true' : undefined} onChange={(e) => set({ adminId: e.target.value || null })}>
            <option value="">All admins</option>
            {adminId && !admins.some((a) => a.id === adminId) ? <option value={adminId}>Selected admin</option> : null}
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email} ({isAdminRole(a.role) ? ROLE_LABELS[a.role] : a.role})
              </option>
            ))}
          </select>
        </div>
        <ClearFilters show={filtered} onClear={() => set({ action: null, targetType: null, adminId: null })} />
      </div>

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title="No entries" action={filtered ? <EmptyAction href="/audit">Clear filters</EmptyAction> : null}>
            {filtered ? 'Nothing matches these filters.' : 'No admin actions recorded yet.'}
          </EmptyState>
        }
        skeleton={<TableSkeleton cols={COLS} rows={10} label="Loading audit log…" />}
      >
        {(data) => (
          <>
            <AuditTable items={data.items} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} pageSize={50} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </div>
  );
}

const AuditTable = memo(function AuditTable({ items }: { items: AuditEntry[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const flip = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={COLS} />
        <tbody>
          {items.map((entry) => {
            const rows = auditDiff(entry.before, entry.after);
            const changed = rows.filter((r) => r.changed).length;
            const href = auditTargetHref(entry.targetType, entry.targetId);
            const expanded = open.has(entry.id);
            const target = entry.targetId ? (isUuid(entry.targetId) ? shortId(entry.targetId) : entry.targetId) : '—';
            return (
              <Fragment key={entry.id}>
                <tr data-selected={expanded ? 'true' : undefined}>
                  <td className="nowrap">{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <span className="cell-main">{entry.adminEmail}</span>
                    <span className="role-badge">{isAdminRole(entry.adminRole) ? ROLE_LABELS[entry.adminRole] : entry.adminRole}</span>
                  </td>
                  <td className="mono">{entry.action}</td>
                  <td>
                    <span className="cell-sub">{humanize(entry.targetType)}</span>
                    {href ? (
                      <Link href={href} className="mono" title={entry.targetId ?? undefined}>
                        {target}
                      </Link>
                    ) : (
                      <span className="mono" title={entry.targetId ?? undefined}>
                        {target}
                      </span>
                    )}
                  </td>
                  <td>
                    {rows.length ? (
                      <button type="button" className="btn btn-small" aria-expanded={expanded} aria-controls={`audit-${entry.id}`} onClick={() => flip(entry.id)}>
                        {expanded ? 'Hide' : `Show ${changed} change${changed === 1 ? '' : 's'}`}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr id={`audit-${entry.id}`} className={styles.detail} data-selected="true">
                    <td colSpan={5}>
                      <table className={styles.diff}>
                        <thead>
                          <tr>
                            <th scope="col">Field</th>
                            <th scope="col">Before</th>
                            <th scope="col">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.key} className={r.changed ? styles.changed : undefined}>
                              <th scope="row" className="mono">
                                {r.key}
                                {r.changed ? <span className="sr-only"> (changed)</span> : null}
                              </th>
                              <td>{r.before === undefined ? <span className={styles.absent}>not set</span> : <pre>{r.before}</pre>}</td>
                              <td>{r.after === undefined ? <span className={styles.absent}>not set</span> : <pre>{r.after}</pre>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
