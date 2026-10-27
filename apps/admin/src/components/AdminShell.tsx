'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { api, goToLogin, logout, sessionStore } from '@/lib/api';
import { msUntilWarning } from '@/lib/session-expiry';
import { ActionDialog } from './dialogs';

// Shown rarely (after a click, or 5 minutes before the 8-hour login ends): kept out of the shell's first load.
const SessionExpiryBar = dynamic(() => import('./SessionExpiry').then((m) => m.SessionExpiryBar));
import type { Dashboard } from '@/lib/admin-types';
import { canVisit, navFor, ROLE_LABELS, type NavItem } from '@/lib/roles';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/hooks/useSession';
import { ClientOnly } from './ClientOnly';
import { ShellContext, type ShellValue } from './ShellContext';
import { ToastProvider, useToast } from './Toast';
import styles from './AdminShell.module.css';
import { SecondFactorDialog } from './SecondFactorDialog';

/** The logged-in frame: guard, sidebar, header. Everything inside renders only in the browser. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ClientOnly fallback={<ShellFallback />}>
      <ToastProvider>
        <Guarded>{children}</Guarded>
      </ToastProvider>
    </ClientOnly>
  );
}

function Guarded({ children }: { children: ReactNode }) {
  const session = useSession();

  useEffect(() => {
    if (!session) goToLogin();
  }, [session]);

  if (!session) return null; // redirecting to /login
  return <Frame key={session.token}>{children}</Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  const session = useSession()!;
  const toast = useToast();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const counts = useApiQuery<Dashboard>('/v1/admin/dashboard');
  const { role, email } = session.admin;
  const { reload } = counts;

  // Badges and system alerts stay fresh while the tab is open: every 2 minutes, and on return to the tab.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = window.setInterval(refresh, 120_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);

  // Pick up a role change made by another admin; a 401 here ends the session.
  useEffect(() => {
    api.get<{ id: string; email: string; role: string }>('/v1/admin/me').then(
      (me) => sessionStore.updateAdmin(me),
      () => undefined,
    );
  }, []);

  // Tokens are not renewed: when this one expires, go to login instead of failing on the next click.
  useEffect(() => {
    const timer = window.setTimeout(() => goToLogin('expired'), Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session.expiresAt]);

  const refreshCounts = useCallback(() => reload(), [reload]);
  const value = useMemo<ShellValue>(
    () => ({ session, toast, counts: counts.data, countsState: counts, refreshCounts }),
    [session, toast, counts, refreshCounts],
  );
  const alerts = counts.data?.openAlerts ?? 0;

  const nav = navFor(role);
  const closeMenu = () => setMenuOpen(false);

  return (
    <ShellContext.Provider value={value}>
      <div className={styles.shell}>
        <a className={styles.skip} href="#content">
          Skip to content
        </a>

        {menuOpen ? <button type="button" className={styles.scrim} aria-label="Close menu" onClick={closeMenu} /> : null}

        <nav id="admin-nav" className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`} aria-label="Admin">
          <Link href="/dashboard" className={styles.wordmark} onNavigate={closeMenu}>
            EventSeva <span>ADMIN</span>
          </Link>
          {nav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} counts={counts.data} onNavigate={closeMenu} />
          ))}
          <div className={styles.sideFoot}>Prayagraj · {ROLE_LABELS[role]}</div>
        </nav>

        <div className={styles.main}>
          <header className={styles.header}>
            <button
              type="button"
              className={`btn btn-small ${styles.menuButton}`}
              aria-expanded={menuOpen}
              aria-controls="admin-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              ☰ Menu
            </button>
            <div className={styles.who}>
              <span className={styles.email} title={email}>
                {email}
              </span>
              <span className="role-badge">{ROLE_LABELS[role]}</span>
            </div>
            {alerts > 0 ? (
              <Link href="/dashboard#alerts" className={styles.alertLink}>
                <span aria-hidden="true">⚠</span> {alerts} system {alerts === 1 ? 'alert' : 'alerts'}
              </Link>
            ) : null}
            <button type="button" className="btn btn-small" onClick={() => setConfirmLogout(true)}>
              Log out
            </button>
          </header>
          <SessionExpiry expiresAt={session.expiresAt} />
          <SecondFactorDialog />

          <main id="content" className={styles.content} tabIndex={-1}>
            {canVisit(role, pathname) ? children : <NoAccess />}
          </main>
        </div>
      </div>
      {confirmLogout ? (
        <ActionDialog
          title="Log out of the admin panel?"
          description={
            <p>
              This ends every login of <b>{email}</b>, in all tabs and on other computers. You need your password and a 2FA code to log in again.
            </p>
          }
          confirmLabel="Log out everywhere"
          busyLabel="Logging out…"
          cancelLabel="Stay logged in"
          tone="danger"
          onConfirm={logout}
          successMessage="Logged out."
          onClose={() => setConfirmLogout(false)}
          onDone={() => undefined}
        />
      ) : null}
    </ShellContext.Provider>
  );
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavLink({
  item,
  active,
  counts,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  counts: Dashboard | undefined;
  onNavigate: () => void;
}) {
  const count = item.badge && counts ? counts[item.badge] : 0;
  const isAlert = item.badge === 'openAlerts';
  return (
    <Link href={item.href} className={styles.link} aria-current={active ? 'page' : undefined} onNavigate={onNavigate}>
      {item.label}
      {count ? (
        <span className={`${styles.badge} ${isAlert ? styles.badgeAlert : ''}`} aria-label={isAlert ? `${count} open system ${count === 1 ? 'alert' : 'alerts'}` : `${count} waiting`}>
          {isAlert ? '⚠ ' : ''}
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/** Waits quietly until 5 minutes before the token ends, then shows the countdown bar. */
function SessionExpiry({ expiresAt }: { expiresAt: number }) {
  const [warn, setWarn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWarn(true), msUntilWarning(expiresAt, Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  return warn ? <SessionExpiryBar expiresAt={expiresAt} /> : null;
}

function NoAccess() {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden="true">
        ⛔
      </span>
      <h1>No access</h1>
      <p className="muted">Your admin role cannot open this page. Ask a super admin if you need it.</p>
      <Link className="btn btn-primary" href="/dashboard">
        Go to dashboard
      </Link>
    </div>
  );
}

/** Shown while the shell starts in the browser (and in the prerendered HTML). */
export function ShellFallback() {
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar} aria-hidden="true">
        <span className={styles.wordmark}>
          EventSeva <span>ADMIN</span>
        </span>
      </div>
      <div className={styles.fallbackMain} role="status">
        <span className="sr-only">Loading the admin panel…</span>
        <div className={styles.fallbackHeader} aria-hidden="true" />
        <div className={styles.fallbackBody} aria-hidden="true">
          <span className="skel" style={{ width: '12rem', height: '2rem' }} />
          <span className="skel" style={{ width: '100%', height: '6rem' }} />
          <span className="skel" style={{ width: '100%', height: '14rem' }} />
        </div>
      </div>
    </div>
  );
}
