'use client';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useBusy } from '@/hooks/useBusy';
import { useModalDialog } from '@/hooks/useModalDialog';
import { describeError } from '@/lib/errors';
import { Button } from './Button';
import { useShell } from './ShellContext';

export interface FormDialogProps {
  title: string;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** The fields. `tried` is true after the first submit, to show their errors. */
  children: (tried: boolean) => ReactNode;
  /** false blocks the submit (the fields show why). */
  valid: boolean;
  /** Runs the API call. */
  onConfirm: () => Promise<unknown>;
  successMessage: string;
  /** Turns a known API error into the text to show in the dialog; null falls back to the standard sentence. */
  describeError?: (error: unknown) => string | null;
  onClose: () => void;
  /** After success: reload the data on the page. */
  onDone: () => void;
}

/**
 * Like ActionDialog, for actions that need more than one field (refund amount + reason, days +
 * reason). Mount it only while open. On a failed submit the first wrong field gets focus.
 */
export function FormDialog({
  title,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Go back',
  tone = 'primary',
  children,
  valid,
  onConfirm,
  successMessage,
  describeError: describe,
  onClose,
  onDone,
}: FormDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { toast, refreshCounts } = useShell();
  const [tried, setTried] = useState(false);
  const [busy, run] = useBusy();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const dialogProps = useModalDialog(ref, { busy, onClose });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (!valid) {
      const form = event.currentTarget;
      // After the errors render, focus the first field marked invalid.
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    void run(async () => {
      setError(null);
      try {
        await onConfirm();
      } catch (e) {
        setError(describe?.(e) ?? describeError(e));
        return;
      }
      toast.success(successMessage);
      refreshCounts();
      onClose();
      onDone();
    });
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-title`} {...dialogProps}>
      <form className="dialog-body" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <h2 id={`${id}-title`} className="dialog-question">
          {title}
        </h2>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          {children(tried)}
        </fieldset>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <Button type="submit" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} busy={busy} busyLabel={busyLabel ?? 'Working…'}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
