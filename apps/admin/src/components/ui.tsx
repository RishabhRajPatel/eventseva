'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { describeError, isApiError } from '@/lib/errors';
import { statusLabel, type StatusLabel } from '@/lib/labels';
import type { QueryState } from '@/hooks/useApiQuery';

export function StatusPill({ map, status }: { map: Record<string, StatusLabel>; status: string }) {
  const { label, tone } = statusLabel(map, status);
  return <span className={`pill tone-${tone}`}>{label}</span>;
}

/** Page-level loading: a skeleton shaped like a heading and a few cards (UX.md §5: no spinners for content). */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skel-box" aria-hidden="true">
        <span className="skel" style={{ width: '40%', height: '1.25rem' }} />
        <span className="skel" style={{ width: '85%' }} />
        <span className="skel" style={{ width: '70%' }} />
      </div>
      <div className="skel-box" aria-hidden="true">
        <span className="skel" style={{ width: '30%', height: '1.25rem' }} />
        <span className="skel" style={{ width: '90%' }} />
        <span className="skel" style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export interface Col {
  label: string;
  /** Right-aligned (money, counts). */
  num?: boolean;
  /** Label only for screen readers (e.g. the "Open" link column). */
  hidden?: boolean;
}

export function TableHead({ cols }: { cols: readonly Col[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c.label} scope="col" className={c.num ? 'num' : undefined}>
            {c.hidden ? <span className="sr-only">{c.label}</span> : c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

const SKELETON_WIDTHS = ['70%', '55%', '80%', '45%', '65%'];

/** The table's real header with shimmering rows, so the layout does not jump when data arrives. */
export function TableSkeleton({ cols, rows = 8, label = 'Loading…' }: { cols: readonly Col[]; rows?: number; label?: string }) {
  return (
    <div className="table-wrap" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <table className="tbl" aria-hidden="true">
        <TableHead cols={cols} />
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cols.map((c, i) => (
                <td key={c.label} className={c.num ? 'num' : undefined}>
                  <span
                    className="skel"
                    style={{ width: c.hidden ? '2.5rem' : SKELETON_WIDTHS[(r + i) % SKELETON_WIDTHS.length], marginLeft: c.num ? 'auto' : undefined, minWidth: '2rem' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Grid of card placeholders (photo moderation, dashboard numbers). */
export function CardSkeleton({ count = 6, minWidth = '15rem', height = '9rem', label = 'Loading…' }: { count?: number; minWidth?: string; height?: string; label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))`, gap: '1rem' }}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-box" aria-hidden="true" style={{ minHeight: height }}>
          <span className="skel" style={{ width: '60%' }} />
          <span className="skel" style={{ width: '40%', height: '1.5rem' }} />
          <span className="skel" style={{ width: '75%', marginTop: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

/** Empty list: an icon, one sentence and at most one action (UX.md §5). */
export function EmptyState({ title, children, action, icon = '∅' }: { title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
      {action ?? null}
    </div>
  );
}

/** The one action of an empty state, as a link styled like a button. */
export function EmptyAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="btn btn-outline-royal btn-small" href={href} scroll={false}>
      {children}
    </Link>
  );
}

export function ErrorState({ error, onRetry, notFound }: { error: unknown; onRetry?: () => void; notFound?: string }) {
  const forbidden = isApiError(error) && error.code === 'FORBIDDEN';
  // A detail page with an unknown id (404) or a malformed one (400 from the UUID check).
  const missing = notFound !== undefined && isApiError(error) && (error.status === 404 || error.status === 400);
  if (missing) return <EmptyState title={notFound} icon="?" />;
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        !
      </span>
      <p>{forbidden ? 'Your admin role cannot open this. Ask a super admin if you need access.' : describeError(error)}</p>
      {onRetry && !forbidden ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Loading, error and empty states for any query, then the content. */
export function QueryView<T>({
  state,
  isEmpty,
  empty,
  loadingLabel,
  skeleton,
  notFound,
  children,
}: {
  state: QueryState<T>;
  /** Detail pages: shown instead of an error when the record does not exist. */
  notFound?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loadingLabel?: string;
  /** Shown while loading, e.g. <TableSkeleton>; defaults to a page skeleton. */
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} notFound={notFound} />;
  if (state.loading || state.data === undefined) return <>{skeleton ?? <LoadingState label={loadingLabel} />}</>;
  if (isEmpty?.(state.data)) return <>{empty ?? <EmptyState title="Nothing here" />}</>;
  return <>{children(state.data)}</>;
}

export function Pager({
  page,
  hasMore,
  hrefFor,
  count,
  pageSize = 20,
}: {
  page: number;
  hasMore: boolean;
  hrefFor: (page: number) => string;
  count: number;
  pageSize?: number;
}) {
  if (page === 1 && !hasMore) return null;
  const from = (page - 1) * pageSize + 1;
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted">
        Showing {from}–{from + count - 1} · page {page}
      </span>
      <div className="btn-row">
        {page > 1 ? (
          <Link className="btn btn-small" href={hrefFor(page - 1)} scroll={false}>
            ← Previous
          </Link>
        ) : null}
        {hasMore ? (
          <Link className="btn btn-small" href={hrefFor(page + 1)} scroll={false}>
            Next {pageSize} →
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export interface TabLink {
  key: string;
  label: string;
  href: string;
  /** Waiting items, shown as a badge (e.g. pending vendors). */
  count?: number;
}

/** Status tabs. They are links, so the current one has aria-current="page", a ✓ and an underline. */
export function TabLinks({ tabs, current, label }: { tabs: TabLink[]; current: string; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.key} className="tab" href={tab.href} aria-current={tab.key === current ? 'page' : undefined} scroll={false}>
          {tab.label}
          {tab.count ? (
            <span className="tab-count" aria-label={`${tab.count} waiting`}>
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function RefreshingHint({ show }: { show: boolean }) {
  return show ? (
    <span className="small muted" role="status">
      Refreshing…
    </span>
  ) : null;
}

/** One label/value pair inside a <dl className="facts">. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "Clear filters" for list pages; only rendered while a filter is on. */
export function ClearFilters({ show, onClear }: { show: boolean; onClear: () => void }) {
  return show ? (
    <button type="button" className="btn btn-small" onClick={onClear}>
      ✕ Clear filters
    </button>
  ) : null;
}
