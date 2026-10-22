'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '@eventseva/app-shared';
import { useShell } from './ShellContext';

export interface FormDialogProps {
  title: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** The fields. `tried` is true after the first submit, to show their errors. */
  children: (tried: boolean) => ReactNode;
  /** false blocks the submit (the fields show why). */
  valid: boolean;
  /** Runs the API call. */
  onConfirm: () => Promise<unknown>;
  successMessage: string;
  /** Turns a known API error into the text to show in the dialog; null falls back to its message. */
  describeError?: (error: unknown) => string | null;
  onClose: () => void;
  /** After success: reload the data on the page. */
  onDone: () => void;
}

/**
 * Like ActionDialog, for actions that need more than one field (refund amount + reason, days +
 * reason). Mount it only while open.
 */
export function FormDialog({ title, confirmLabel, tone = 'primary', children, valid, onConfirm, successMessage, describeError, onClose, onDone }: FormDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { toast, refreshCounts } = useShell();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      toast.success(successMessage);
      refreshCounts();
      onClose();
      onDone();
    } catch (e) {
      setError(describeError?.(e) ?? errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form className="dialog-body" onSubmit={submit} noValidate>
        <h2 id={`${id}-title`}>{title}</h2>
        {children(tried)}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
