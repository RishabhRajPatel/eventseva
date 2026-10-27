'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime } from '@eventseva/app-shared';
import { Button } from '@/components/Button';
import { ActionDialog } from '@/components/dialogs';
import { useShell } from '@/components/ShellContext';
import { CardSkeleton, ErrorState, Fact, PageHead } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/roles';

interface Me {
  id: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  recoveryCodesLeft: number;
  stepUpUntil: string | null;
}

/** The admin's own 2FA: recovery codes (for a lost phone) and the current re-confirm window. */
export function SecurityView() {
  const notice = useSearchParams().get('notice');
  const { toast } = useShell();
  const me = useApiQuery<Me>('/v1/admin/me');
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const text = codes ? `EventSeva admin recovery codes (${me.data?.email ?? ''})\nEach code works once.\n\n${codes.join('\n')}\n` : '';

  return (
    <div className="page">
      <PageHead title="My security" subtitle="Your login is protected by a password and a code from your authenticator app." />

      {notice === 'recovery' ? (
        <p className="note note-warning" role="status">
          You logged in with a recovery code, and that code no longer works. If your phone is lost, ask a super admin to reset your 2FA,
          and make new recovery codes below.
        </p>
      ) : notice === 'low' ? (
        <p className="note note-warning" role="status">
          You have only a few recovery codes left. Make new ones below and keep them somewhere safe.
        </p>
      ) : null}

      {me.error ? <ErrorState error={me.error} onRetry={me.reload} /> : null}
      {!me.data && !me.error ? <CardSkeleton count={2} height="7rem" /> : null}

      {me.data ? (
        <section className="box stack" aria-labelledby="twofa-title">
          <h2 id="twofa-title">Two-step login</h2>
          <dl className="facts">
            <Fact label="Account">{me.data.email}</Fact>
            <Fact label="Role">{ROLE_LABELS[me.data.role]}</Fact>
            <Fact label="2FA">✓ On (authenticator app)</Fact>
            <Fact label="Recovery codes left">
              <span className={me.data.recoveryCodesLeft <= 2 ? 'field-error' : undefined}>{me.data.recoveryCodesLeft} of 8</span>
            </Fact>
            <Fact label="Re-confirmed until">{me.data.stepUpUntil ? formatDateTime(me.data.stepUpUntil) : 'Not now'}</Fact>
          </dl>
          <p className="small muted">
            Refunds, payouts, bank details, CSV exports and blocking ask for a fresh code; after one, the next 5 minutes need no new
            code in this login. Each code works only once.
          </p>
          <div className="btn-row">
            <Button className="btn btn-outline-royal" onClick={() => setConfirming(true)}>
              Make new recovery codes
            </Button>
          </div>
        </section>
      ) : null}

      {codes ? (
        <section className="box stack" aria-labelledby="codes-title" role="region">
          <h2 id="codes-title">Your new recovery codes</h2>
          <p className="note note-warning">
            Save these now: they are shown only once. Each works one time, instead of the 6-digit code, if you lose your phone.
          </p>
          <ol className="mono" style={{ columns: 2, fontSize: '1.1rem', lineHeight: 1.9 }} aria-label="Recovery codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <div className="btn-row">
            <Button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                toast.success('Codes copied. Paste them into your password manager.');
              }}
            >
              Copy
            </Button>
            <Button
              className="btn"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'eventseva-recovery-codes.txt';
                a.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
              }}
            >
              Download .txt
            </Button>
            <Button className="btn btn-primary" onClick={() => setCodes(null)}>
              I have saved them
            </Button>
          </div>
        </section>
      ) : null}

      {confirming ? (
        <ActionDialog
          title="Make new recovery codes?"
          description={<p>Your current unused recovery codes stop working at once. You will see the 8 new codes only once.</p>}
          confirmLabel="Make new codes"
          busyLabel="Making…"
          tone="primary"
          onConfirm={async () => {
            const res = await api.post<{ codes: string[] }>('/v1/admin/me/recovery-codes');
            setCodes(res.codes);
            return res;
          }}
          successMessage="New recovery codes made. Save them now."
          onClose={() => setConfirming(false)}
          onDone={me.reload}
        />
      ) : null}
    </div>
  );
}
