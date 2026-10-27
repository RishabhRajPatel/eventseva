'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@eventseva/app-shared';
import { Button } from '@/components/Button';
import { ClientOnly } from '@/components/ClientOnly';
import { useBusy } from '@/hooks/useBusy';
import { api, sessionStore } from '@/lib/api';
import { describeError } from '@/lib/errors';
import type { AdminLoginResult } from '@/lib/session';
import { checkLogin, cleanRecoveryCode, cleanTotp, safeNextPath, type LoginErrors } from '@/lib/validate';
import styles from './login.module.css';

export function LoginForm() {
  return (
    <ClientOnly fallback={<LoginShell />}>
      <LoginFormInner />
    </ClientOnly>
  );
}

function LoginFormInner() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const expired = searchParams.get('reason') === 'expired';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, run] = useBusy();

  // Already logged in in this tab: skip the form.
  useEffect(() => {
    if (sessionStore.read()) window.location.replace(next);
  }, [next]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found = checkLogin({ email, password, totp, recoveryCode, useRecovery });
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    void run(async () => {
      try {
        const second = useRecovery ? { recoveryCode: cleanRecoveryCode(recoveryCode)! } : { totp };
        const result = await api.post<AdminLoginResult>('/v1/admin/login', { email: email.trim(), password, ...second }, { auth: false });
        sessionStore.save(result);
        // Full load, so the panel starts clean for this admin. Stays busy until the page changes.
        // After a recovery code (or with few left), go to My security to make new ones.
        const low = (result.recoveryCodesLeft ?? 8) <= 2;
        window.location.replace(result.usedRecoveryCode || low ? `/security?notice=${result.usedRecoveryCode ? 'recovery' : 'low'}` : next);
        await new Promise(() => undefined);
      } catch (e) {
        // ADMIN_LOGIN_FAILED is one generic message on purpose: it never says which part was wrong.
        setFormError(describeError(e));
        if (e instanceof ApiError && e.code === 'ADMIN_LOGIN_FAILED') {
          setTotp('');
          setRecoveryCode('');
          requestAnimationFrame(() => document.getElementById(useRecovery ? 'recovery' : 'totp')?.focus());
        }
      }
    });
  }

  return (
    <LoginShell>
      <form className="stack" onSubmit={submit} noValidate>
        {expired && !formError ? (
          <p className="note note-warning" role="status">
            Your session ended (admin logins last 8 hours). Log in again to continue where you were.
          </p>
        ) : null}
        {formError ? (
          <p className="inline-error" role="alert">
            {formError}
          </p>
        ) : null}

        <Field id="email" label="Email" error={errors.email}>
          <input
            id="email"
            type="email"
            className={`input ${styles.input}`}
            placeholder="name@eventseva.in"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            autoFocus
          />
        </Field>

        <Field id="password" label="Password" error={errors.password}>
          <input
            id="password"
            type="password"
            className={`input ${styles.input}`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
        </Field>

        {useRecovery ? (
          <Field id="recovery" label="Recovery code" error={errors.recoveryCode}>
            <input
              id="recovery"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              className={`input ${styles.totp}`}
              placeholder="ABCDE-FGHJK"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              aria-invalid={errors.recoveryCode ? true : undefined}
              aria-describedby={errors.recoveryCode ? 'recovery-error' : 'recovery-hint'}
            />
            <span id="recovery-hint" className="hint">
              Each code works once. Make new ones under My security after logging in.
            </span>
          </Field>
        ) : (
          <Field id="totp" label="2FA code (authenticator app)" error={errors.totp}>
            <input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className={`input ${styles.totp}`}
              placeholder="6 digits"
              value={totp}
              onChange={(e) => setTotp(cleanTotp(e.target.value))}
              aria-invalid={errors.totp ? true : undefined}
              aria-describedby={errors.totp ? 'totp-error' : undefined}
            />
          </Field>
        )}
        <button
          type="button"
          className="btn-link small"
          onClick={() => {
            setUseRecovery((r) => !r);
            setErrors({});
          }}
        >
          {useRecovery ? 'Use the code from my authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>

        <Button type="submit" className={`btn btn-primary ${styles.submit}`} busy={busy} busyLabel="Logging in…">
          Log in
        </Button>
      </form>
    </LoginShell>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** The card around the form; also the prerendered fallback. */
export function LoginShell({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.screen}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.wordmark}>EventSeva</div>
          <h1 className={styles.title}>Admin panel</h1>
          <p className="small muted">For the EventSeva team only</p>
        </div>
        {children ?? <div className="spinner" role="status" aria-label="Loading" />}
        <div className={styles.lock}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#23262f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>5 wrong attempts lock the account for 15 minutes. Every admin action is recorded in the audit log.</span>
        </div>
      </main>
    </div>
  );
}
