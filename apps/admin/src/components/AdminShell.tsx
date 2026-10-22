'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, goToLogin, logout, sessionStore } from '@/lib/api';
import type { Dashboard } from '@/lib/admin-types';
import { canVisit, navFor, ROLE_LABELS, type NavItem } from '@/lib/roles';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/hooks/useSession';
import { ClientOnly } from './ClientOnly';
import { ShellContext, type ShellValue } from './ShellContext';
import { ToastProvider, useToast } from './Toast';
import styles from './AdminShell.module.css';

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
  const counts = useApiQuery<Dashboard>('/v1/admin/dashboard');
  const { role, email } = session.admin;

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

  const { reload } = counts;
  const refreshCounts = useCallback(() => reload(), [reload]);
  const value = useMemo<ShellValue>(
    () => ({ session, toast, counts: counts.data, refreshCounts }),
    [session, toast, counts.data, refreshCounts],
  );

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
            <button type="button" className="btn btn-small" onClick={() => void logout()}>
              Log out
            </button>
          </header>

          <main id="content" className={styles.content} tabIndex={-1}>
            {canVisit(role, pathname) ? children : <NoAccess />}
          </main>
        </div>
      </div>
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
  return (
    <Link href={item.href} className={styles.link} aria-current={active ? 'page' : undefined} onNavigate={onNavigate}>
      {item.label}
      {count ? (
        <span className={styles.badge} aria-label={`${count} waiting`}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function NoAccess() {
  return (
    <div className="state">
      <h1>No access</h1>
      <p className="muted">Your admin role cannot open this page.</p>
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
      <div className={styles.fallbackMain}>
        <div className="spinner" role="status" aria-label="Loading" />
      </div>
    </div>
  );
}
