'use client';
import { smsBudget, SMS_WARN_PERCENT } from '@/lib/alerts';
import styles from './dashboard.module.css';

const BAR: Record<ReturnType<typeof smsBudget>['colour'], string> = {
  royal: styles.barRoyal,
  peach: styles.barPeach,
  red: styles.barRed,
};

/** "OTP SMS (last 24 h): 1,240 / 2,000" with a bar that turns peach at 80% and red at 100%. */
export function SmsBudgetCard({ used, perDay }: { used: number; perDay: number }) {
  const b = smsBudget(used, perDay);
  return (
    <section className={`box stack-sm ${b.level === 'warning' ? styles.smsWarn : b.level !== 'ok' ? styles.smsDanger : ''}`} aria-labelledby="sms-title">
      <div className="section-head">
        <h2 id="sms-title">OTP SMS (last 24 h)</h2>
        <span className={`pill ${b.level === 'ok' ? 'tone-success' : b.level === 'warning' ? 'tone-warning' : 'tone-danger'}`}>{b.percent}%</span>
      </div>
      <p className={styles.smsValue}>
        {b.text} <span className="small muted">daily budget</span>
      </p>
      <div
        className={styles.track}
        role="meter"
        aria-labelledby="sms-title"
        aria-valuemin={0}
        aria-valuemax={b.perDay}
        aria-valuenow={Math.min(b.used, b.perDay)}
        aria-valuetext={`${b.text} (${b.percent}%). ${b.status}`}
      >
        <span className={`${styles.bar} ${BAR[b.colour]}`} style={{ width: `${b.fill}%` }} />
        <span className={styles.tick} style={{ left: `${SMS_WARN_PERCENT}%` }} aria-hidden="true" />
      </div>
      <p className={`small ${b.level === 'ok' ? 'muted' : b.level === 'warning' ? styles.smsStatus : styles.smsStatusDanger}`}>{b.status}</p>
      <p className="small muted">
        Login codes for both apps. At {SMS_WARN_PERCENT}% you get an alert; at 100% new sign-ups pause; at 150% all codes stop.
      </p>
    </section>
  );
}
