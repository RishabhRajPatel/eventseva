'use client';
import Link from 'next/link';
import { rupees, type BookingStatus } from '@eventseva/app-shared';
import { BOOKING_STATUSES } from '@eventseva/core';
import { BarChart } from '@/components/BarChart';
import { useShell } from '@/components/ShellContext';
import { PageHead, QueryView, StatusPill } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { Dashboard } from '@/lib/admin-types';
import { BOOKING_STATUS } from '@/lib/labels';
import { canView, type AdminRole, type Section } from '@/lib/roles';
import styles from './dashboard.module.css';

interface StatDef {
  label: string;
  value: (d: Dashboard) => string | number;
  hint?: string;
  href?: string;
  section?: Section;
  attention?: (d: Dashboard) => boolean;
}

const STATS: StatDef[] = [
  { label: 'Pending vendors', value: (d) => d.pendingVendors, href: '/vendors', section: 'vendors', attention: (d) => d.pendingVendors > 0 },
  { label: 'Live vendors', value: (d) => d.liveVendors, href: '/vendors?status=approved', section: 'vendors' },
  { label: 'Users', value: (d) => d.users, href: '/users', section: 'users' },
  { label: 'New users today', value: (d) => d.newUsersToday, href: '/users', section: 'users' },
  { label: 'Bookings today', value: (d) => d.bookingsToday, hint: 'Requests made today', href: '/bookings', section: 'bookings' },
  { label: 'Confirmed this month', value: (d) => d.monthConfirmed, hint: 'Events this month', href: '/bookings?status=confirmed', section: 'bookings' },
  { label: 'GMV this month', value: (d) => rupees(d.monthGmvPaise), hint: 'Confirmed + completed', href: '/bookings?status=confirmed', section: 'bookings' },
  { label: 'Commission this month', value: (d) => rupees(d.monthCommissionPaise), hint: 'EventSeva earnings', href: '/payouts', section: 'payouts' },
  { label: 'Featured sales this month', value: (d) => rupees(d.monthFeaturedPaise), hint: 'Paid by vendors', href: '/featured', section: 'featured' },
  { label: 'Coupon discounts this month', value: (d) => rupees(d.monthDiscountPaise), hint: 'Paid by EventSeva', href: '/coupons', section: 'coupons' },
  { label: 'Net revenue this month', value: (d) => rupees(d.monthNetRevenuePaise), hint: 'Commission − discounts + featured' },
  { label: 'Featured vendors', value: (d) => d.featuredVendors, hint: 'Featured right now', href: '/featured', section: 'featured' },
  { label: 'Open complaints', value: (d) => d.openComplaints, href: '/complaints', section: 'complaints', attention: (d) => d.openComplaints > 0 },
  { label: 'Pending photos', value: (d) => d.pendingMedia, href: '/photos', section: 'photos', attention: (d) => d.pendingMedia > 0 },
  { label: 'Payouts due', value: (d) => d.duePayouts, hint: 'Scheduled, release time passed', href: '/payouts?status=scheduled&due=true', section: 'payouts', attention: (d) => d.duePayouts > 0 },
];

export function DashboardView() {
  const { session } = useShell();
  const role = session.admin.role;
  const state = useApiQuery<Dashboard>('/v1/admin/dashboard');

  return (
    <div className="page">
      <PageHead title="Dashboard" subtitle={state.data ? `Prayagraj · ${monthName(state.data.month)}` : 'Prayagraj'} />
      <QueryView state={state} loadingLabel="Loading dashboard…">
        {(d) => (
          <>
            <section aria-label="Key numbers" className={styles.stats}>
              {STATS.map((stat) => (
                <StatCard key={stat.label} stat={stat} data={d} role={role} />
              ))}
            </section>

            <div className={styles.panels}>
              <section className={`box stack ${styles.chart}`} aria-labelledby="chart-title">
                <div className="section-head">
                  <h2 id="chart-title">Bookings, last 14 days</h2>
                  <span className="small muted">New requests per day</span>
                </div>
                <BarChart data={d.last14Days} title="Bookings per day, last 14 days" />
              </section>

              <div className={`stack ${styles.side}`}>
                <NeedsAction data={d} role={role} />
                <ByStatus data={d} role={role} />
                <TopCategories data={d} />
              </div>
            </div>
          </>
        )}
      </QueryView>
    </div>
  );
}

function StatCard({ stat, data, role }: { stat: StatDef; data: Dashboard; role: AdminRole }) {
  const allowed = Boolean(stat.section && canView(role, stat.section));
  // Highlight only what this role can act on.
  const className = `${styles.stat} ${allowed && stat.attention?.(data) ? styles.attention : ''}`;
  const body = (
    <>
      <span className={styles.statLabel}>{stat.label}</span>
      <span className={styles.statValue}>{stat.value(data)}</span>
      {stat.hint ? <span className={styles.statHint}>{stat.hint}</span> : null}
    </>
  );
  // Only link to pages this role can open.
  if (stat.href && allowed) {
    return (
      <Link href={stat.href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function NeedsAction({ data, role }: { data: Dashboard; role: AdminRole }) {
  const items = [
    { section: 'vendors' as const, href: '/vendors', label: 'Vendors waiting for verification', n: data.pendingVendors, warn: false },
    { section: 'photos' as const, href: '/photos', label: 'Photos to review', n: data.pendingMedia, warn: false },
    { section: 'complaints' as const, href: '/complaints', label: 'Open complaints', n: data.openComplaints, warn: true },
    { section: 'payouts' as const, href: '/payouts?status=scheduled&due=true', label: 'Payouts due', n: data.duePayouts, warn: true },
  ].filter((item) => canView(role, item.section) && item.n > 0);

  return (
    <section className="box stack-sm" aria-labelledby="todo-title">
      <h2 id="todo-title">Needs action</h2>
      {items.length === 0 ? (
        <p className="muted">All clear. Nothing is waiting for you.</p>
      ) : (
        items.map((item) => (
          <Link key={item.href} href={item.href} className={`${styles.todo} ${item.warn ? styles.todoWarn : ''}`}>
            <span>{item.label}</span>
            <b>{item.n}</b>
          </Link>
        ))
      )}
    </section>
  );
}

function ByStatus({ data, role }: { data: Dashboard; role: AdminRole }) {
  const rows = BOOKING_STATUSES.map((status) => ({ status, n: data.bookingsByStatus[status] ?? 0 })).filter((r) => r.n > 0);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const linkable = canView(role, 'bookings');
  return (
    <section className="box stack-sm" aria-labelledby="status-title">
      <div className="section-head">
        <h2 id="status-title">Bookings by status</h2>
        <span className="small muted">Made this month</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No bookings this month yet.</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((r) => (
            <li key={r.status}>
              {linkable ? (
                <Link href={`/bookings?status=${r.status}`} aria-label={`${r.n} ${r.status} bookings`}>
                  <StatusPill map={BOOKING_STATUS} status={r.status satisfies BookingStatus} />
                </Link>
              ) : (
                <StatusPill map={BOOKING_STATUS} status={r.status} />
              )}
              <b className="nowrap">
                {r.n} <span className="small muted">({Math.round((r.n / total) * 100)}%)</span>
              </b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopCategories({ data }: { data: Dashboard }) {
  const top = data.topCategories;
  const max = Math.max(1, ...top.map((c) => c.bookings));
  return (
    <section className="box stack-sm" aria-labelledby="top-title">
      <div className="section-head">
        <h2 id="top-title">Top categories</h2>
        <span className="small muted">Confirmed this month</span>
      </div>
      {top.length === 0 ? (
        <p className="muted">No confirmed bookings this month yet.</p>
      ) : (
        <ul className={styles.rows}>
          {top.map((c) => (
            <li key={c.slug}>
              <span>{c.name}</span>
              <b>{c.bookings}</b>
              <span className={styles.meter} aria-hidden="true">
                <span style={{ width: `${(c.bookings / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function monthName(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
