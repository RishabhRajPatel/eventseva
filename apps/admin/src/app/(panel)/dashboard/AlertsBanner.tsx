'use client';
import Link from 'next/link';
import { memo, useState } from 'react';
import { formatDateTime } from '@eventseva/app-shared';
import { Button } from '@/components/Button';
import { useShell } from '@/components/ShellContext';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { useNow } from '@/hooks/useNow';
import { alertGuide, openAlerts, timeAgo, type SystemAlert } from '@/lib/alerts';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, canView } from '@/lib/roles';
import styles from './dashboard.module.css';

/**
 * Open system alerts at the top of the dashboard (SMS budget at 80%, used up, hard stop), with what to do
 * for each. Only fetched while the dashboard count says there are open ones.
 */
export function AlertsBanner({ openCount, onChanged }: { openCount: number; onChanged: () => void }) {
  const state = useApiQuery<{ items: SystemAlert[] }>(openCount > 0 ? '/v1/admin/alerts' : null);
  const now = useNow(60_000);
  // A new alert (or one resolved elsewhere) changes the dashboard count: refresh the list, keeping it on screen.
  const [seenCount, setSeenCount] = useState(openCount);
  if (seenCount !== openCount) {
    setSeenCount(openCount);
    state.reload();
  }
  if (openCount === 0) return null;

  const open = state.data ? openAlerts(state.data.items) : [];
  return (
    <section id="alerts" className={styles.alerts} aria-labelledby="alerts-title" tabIndex={-1}>
      <h2 id="alerts-title" className={styles.alertsTitle}>
        <span aria-hidden="true">⚠</span> {openCount} system {openCount === 1 ? 'alert needs' : 'alerts need'} attention
      </h2>
      {state.error ? (
        <p className="inline-error" role="alert">
          The alerts could not be loaded. {describeError(state.error)}{' '}
          <button type="button" className="btn-link" onClick={state.reload}>
            Try again
          </button>
        </p>
      ) : !state.data ? (
        <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
          <span className="sr-only">Loading alerts…</span>
          <span className="skel" style={{ width: '60%' }} aria-hidden="true" />
          <span className="skel" style={{ width: '85%' }} aria-hidden="true" />
        </div>
      ) : open.length === 0 ? (
        <p className="small">These alerts were resolved meanwhile.</p>
      ) : (
        open.map((a) => <AlertItem key={a.id} alert={a} now={now} onResolved={() => (state.reload(), onChanged())} />)
      )}
    </section>
  );
}

const AlertItem = memo(function AlertItem({ alert: a, now, onResolved }: { alert: SystemAlert; now: number; onResolved: () => void }) {
  const { session, toast } = useShell();
  const role = session.admin.role;
  const guide = alertGuide(a.kind);
  const [busy, run] = useBusy();

  const resolve = () =>
    run(async () => {
      try {
        await api.post(`/v1/admin/alerts/${a.id}/resolve`);
        toast.success(`Marked resolved: ${guide.title}. It stays in the audit log.`);
      } catch (e) {
        toast.error(describeError(e));
      }
      onResolved();
    });

  return (
    <article className={`${styles.alert} ${guide.severity === 'danger' ? styles.alertDanger : styles.alertWarning}`} aria-labelledby={`alert-${a.id}`}>
      <div className={styles.alertHead}>
        <h3 id={`alert-${a.id}`}>
          <span aria-hidden="true">{guide.severity === 'danger' ? '⛔' : '⚠'}</span> {guide.title}
        </h3>
        <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)} className={styles.alertTime}>
          {timeAgo(a.createdAt, now || undefined)}
        </time>
      </div>
      <p>{a.message}</p>
      <p className={styles.alertTodo}>
        <b>What to do:</b> {guide.whatToDo}
      </p>
      <div className="btn-row">
        {canView(role, 'users') ? (
          <Link href="/users" className="btn btn-small btn-outline-royal">
            Open Users
          </Link>
        ) : null}
        {can(role, 'alert.resolve') ? (
          <Button className="btn btn-small btn-primary" busy={busy} busyLabel="Resolving…" onClick={resolve}>
            Mark resolved
          </Button>
        ) : (
          <span className="small">Support or a super admin can mark it resolved.</span>
        )}
      </div>
    </article>
  );
});
