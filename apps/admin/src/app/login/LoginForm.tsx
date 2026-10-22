'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, errorMessage } from '@eventseva/app-shared';
import { ClientOnly } from '@/components/ClientOnly';
import { api, sessionStore } from '@/lib/api';
import type { AdminLoginResult } from '@/lib/session';
import { checkLogin, cleanTotp, safeNextPath, type LoginErrors } from '@/lib/validate';
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
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in in this tab: skip the form.
  useEffect(() => {
    if (sessionStore.read()) window.location.replace(next);
  }, [next]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = checkLogin({ email, password, totp });
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const result = await api.post<AdminLoginResult>(
        '/v1/admin/login',
        { email: email.trim(), password, totp },
        { auth: false },
      );
      sessionStore.save(result);
      // Full load, so the panel starts clean for this admin.
      window.location.replace(next);
    } catch (e) {
      // ADMIN_LOGIN_FAILED is one generic message on purpose: it never says which part was wrong.
      setFormError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'ADMIN_LOGIN_FAILED') setTotp('');
      setBusy(false);
    }
  }

  return (
    <LoginShell>
      <form className="stack" onSubmit={submit} noValidate>
        {expired && !formError ? (
          <p className="note note-warning" role="status">
            Your session ended. Please log in again.
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

        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
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
