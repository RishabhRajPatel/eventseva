'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, errorMessage } from '@eventseva/app-shared';
import { checkLength } from '@/lib/validate';
import { useShell } from './ShellContext';

export interface TextInputSpec {
  label: string;
  /** Used in validation messages: "Reason is required." */
  what?: string;
  hint?: string;
  placeholder?: string;
  limits: { min: number; max: number };
  multiline?: boolean;
  /** One-click answers that fill the field. */
  presets?: string[];
}

export interface ActionDialogProps {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  input?: TextInputSpec;
  /** Runs the API call; receives the trimmed text when there is an input. */
  onConfirm: (text: string) => Promise<unknown>;
  successMessage: string;
  onClose: () => void;
  /** After success: reload the data on the page. */
  onDone: () => void;
}

/**
 * Error codes meaning someone else changed the record meanwhile: close, say why and reload,
 * because retrying the same action cannot work.
 */
const STALE_CODES = new Set(['VENDOR_BAD_STATUS', 'PAYOUT_BAD_STATUS', 'MEDIA_BAD_STATUS', 'NOT_FOUND']);

/**
 * Confirmation for every mutation, with an optional required text (reason, UTR, resolution).
 * Mount it only while open. Uses the native <dialog>, which traps focus and closes on Escape.
 */
export function ActionDialog({
  title,
  description,
  confirmLabel,
  tone = 'primary',
  input,
  onConfirm,
  successMessage,
  onClose,
  onDone,
}: ActionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { toast, refreshCounts } = useShell();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Closed when the page is hidden by navigation (Activity) or unmounted; re-opened on return.
    return () => dialog?.close();
  }, []);

  const inputError = input ? checkLength(text, input.limits, input.what) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (inputError || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      toast.success(successMessage);
      refreshCounts();
      onClose();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && STALE_CODES.has(e.code)) {
        toast.error(`${e.message} The page has been refreshed.`);
        onClose();
        onDone();
        return;
      }
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const showInputError = touched && inputError;
  const Field = input?.multiline ? 'textarea' : 'input';

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
        {description ? <div className="stack-sm">{description}</div> : null}

        {input ? (
          <div className="field">
            <label htmlFor={`${id}-text`}>{input.label}</label>
            {input.presets?.length ? (
              <div className="chips" role="group" aria-label="Common answers">
                {input.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="chip"
                    aria-pressed={text === preset}
                    onClick={() => setText(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            ) : null}
            <Field
              id={`${id}-text`}
              className={input.multiline ? 'textarea' : 'input'}
              value={text}
              placeholder={input.placeholder}
              maxLength={input.limits.max}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showInputError ? true : undefined}
              aria-describedby={`${id}-hint`}
              autoFocus
              rows={input.multiline ? 4 : undefined}
            />
            <span id={`${id}-hint`} className={showInputError ? 'field-error' : 'hint'}>
              {showInputError ? inputError : (input.hint ?? `${input.limits.min}–${input.limits.max} characters.`)}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} autoFocus={!input}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
