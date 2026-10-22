'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '@eventseva/app-shared';
import { statusLabel, type StatusLabel } from '@/lib/labels';
import type { QueryState } from '@/hooks/useApiQuery';

export function StatusPill({ map, status }: { map: Record<string, StatusLabel>; status: string }) {
  const { label, tone } = statusLabel(map, status);
  return <span className={`pill tone-${tone}`}>{label}</span>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{label}</p>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, notFound }: { error: unknown; onRetry?: () => void; notFound?: string }) {
  const forbidden = error instanceof ApiError && error.code === 'FORBIDDEN';
  // A detail page with an unknown id (404) or a malformed one (400 from the UUID check).
  const missing = notFound !== undefined && error instanceof ApiError && (error.status === 404 || error.status === 400);
  if (missing) return <EmptyState title={notFound} />;
  return (
    <div className="state state-error" role="alert">
      <p>{forbidden ? 'Your admin role cannot open this.' : errorMessage(error)}</p>
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
  notFound,
  children,
}: {
  state: QueryState<T>;
  /** Detail pages: shown instead of an error when the record does not exist. */
  notFound?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} notFound={notFound} />;
  if (state.loading || state.data === undefined) return <LoadingState label={loadingLabel} />;
  if (isEmpty?.(state.data)) return <>{empty ?? <EmptyState title="Nothing here" />}</>;
  return <>{children(state.data)}</>;
}

export function Pager({
  page,
  hasMore,
  hrefFor,
  count,
}: {
  page: number;
  hasMore: boolean;
  hrefFor: (page: number) => string;
  count: number;
}) {
  if (page === 1 && !hasMore) return null;
  const from = (page - 1) * 20 + 1;
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
            Next 20 →
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
}

export function TabLinks({ tabs, current, label }: { tabs: TabLink[]; current: string; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.key} className="tab" href={tab.href} aria-current={tab.key === current ? 'page' : undefined} scroll={false}>
          {tab.label}
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
