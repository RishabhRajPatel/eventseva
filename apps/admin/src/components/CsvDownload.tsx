'use client';
import { useId, useState, type FormEvent } from 'react';
import { useBusy } from '@/hooks/useBusy';
import { goToLogin, sessionStore } from '@/lib/api';
import { checkRange, exportUrl, filenameFromDisposition } from '@/lib/csv';
import { describeError } from '@/lib/errors';
import { canExport, type ExportKind } from '@/lib/roles';
import { Button } from './Button';
import { useShell } from './ShellContext';

/**
 * "Download CSV" with optional from/to dates (inclusive India days). Fetched with the admin
 * token, because a plain link would not carry it, then saved as a file. Hidden for roles the
 * API would refuse.
 */
export function CsvDownload({ kind, hint }: { kind: ExportKind; hint?: string }) {
  const { session, toast } = useShell();
  const id = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, run] = useBusy();
  if (!canExport(session.admin.role, kind)) return null;
  const rangeError = checkRange(from, to);

  function download(event: FormEvent) {
    event.preventDefault();
    if (rangeError) return;
    const token = sessionStore.read()?.token;
    if (!token) return goToLogin('expired');
    void run(() => save(token));
  }

  async function save(token: string) {
    try {
      const res = await fetch(exportUrl(kind, from, to), { headers: { Authorization: `Bearer ${token}`, Accept: 'text/csv' } });
      if (res.status === 401) {
        sessionStore.clear();
        goToLogin('expired');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        toast.error(
          body?.error?.code
            ? describeError({ status: res.status, code: body.error.code, message: body.error.message ?? '' })
            : describeError({ status: res.status, code: `HTTP_${res.status}`, message: 'The download failed. Please try again.' }),
        );
        return;
      }
      const blob = await res.blob();
      const name = filenameFromDisposition(res.headers.get('Content-Disposition'), `eventseva-${kind}.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Downloaded ${name}. It is in your Downloads folder.`);
    } catch {
      toast.error(describeError({ status: 0, code: 'NETWORK', message: '' }));
    }
  }

  return (
    <form className="filters" onSubmit={download} noValidate aria-label="Download CSV">
      <div className="field" style={{ minWidth: '9.5rem' }}>
        <label htmlFor={`${id}-from`}>From</label>
        <input id={`${id}-from`} type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="field" style={{ minWidth: '9.5rem' }}>
        <label htmlFor={`${id}-to`}>To</label>
        <input
          id={`${id}-to`}
          type="date"
          className="input"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          aria-invalid={rangeError ? true : undefined}
          aria-describedby={`${id}-hint`}
        />
      </div>
      <Button type="submit" className="btn btn-outline-royal" busy={busy} busyLabel="Preparing…" disabled={Boolean(rangeError)}>
        ↓ Download CSV
      </Button>
      <span id={`${id}-hint`} className={rangeError ? 'field-error' : 'hint'} style={{ flexBasis: '100%' }}>
        {rangeError ?? hint ?? 'Dates are optional and inclusive.'}
      </span>
    </form>
  );
}
