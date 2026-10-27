'use client';
import { goToLogin, sessionStore } from '@/lib/api';
import { formatClock, formatRemaining } from '@/lib/session-expiry';
import { useNow } from '@/hooks/useNow';
import styles from './AdminShell.module.css';

/** The countdown bar shown in the last 5 minutes of a login. */
export function SessionExpiryBar({ expiresAt }: { expiresAt: number }) {
  const now = useNow(1000);
  const left = expiresAt - (now || expiresAt);
  return (
    <div className={styles.expiry} role="alert">
      <span>
        <b>Your session ends in {formatRemaining(left)}</b> (at {formatClock(expiresAt)}). Admin logins last 8 hours and cannot be extended.
        Finish or note what you are doing, then log in again.
      </span>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          sessionStore.clear();
          goToLogin();
        }}
      >
        Log in again now
      </button>
    </div>
  );
}
