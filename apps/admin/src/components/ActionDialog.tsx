'use client';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useBusy } from '@/hooks/useBusy';
import { useModalDialog } from '@/hooks/useModalDialog';
import { describeError, isStaleError } from '@/lib/errors';
import { checkLength } from '@/lib/validate';
import { Button } from './Button';
import { useShell } from './ShellContext';
import { runUndo, type UndoSpec } from './undo';

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
  /** A question naming the thing: "Reject this photo?" */
  title: string;
  /** What will happen, with numbers where there are any. */
  description?: ReactNode;
  /** Names the action: "Reject photo", never "OK". */
  confirmLabel: string;
  /** Shown on the confirm button while the request runs: "Rejecting…". */
  busyLabel?: string;
  /** "Go back" by default; "Keep" reads better for some actions. */
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  input?: TextInputSpec;
  /** Runs the API call; receives the trimmed text when there is an input. */
  onConfirm: (text: string) => Promise<unknown>;
  /** A function gets the API result, e.g. to say how many bookings an action closed. */
  successMessage: string | ((result: unknown) => string);
  undo?: UndoSpec;
  onClose: () => void;
  /** After success: reload the data on the page. */
  onDone: () => void;
}

/**
 * Confirmation for every mutation, with an optional required text (reason, UTR, resolution).
 * Mount it only while open. Native modal <dialog>: Esc closes, Tab is kept inside, focus returns
 * to the opener. Enter submits.
 */
export function ActionDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Go back',
  tone = 'primary',
  input,
  onConfirm,
  successMessage,
  undo,
  onClose,
  onDone,
}: ActionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { toast, refreshCounts } = useShell();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useBusy();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const dialogProps = useModalDialog(ref, { busy, onClose });

  const inputError = input ? checkLength(text, input.limits, input.what) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (inputError) {
      document.getElementById(`${id}-text`)?.focus();
      return;
    }
    void run(async () => {
      setError(null);
      let result: unknown;
      try {
        result = await onConfirm(text.trim());
      } catch (e) {
        if (isStaleError(e)) {
          // Someone else changed the record meanwhile: retrying cannot work.
          toast.error(describeError(e));
          onClose();
          onDone();
          refreshCounts();
          return;
        }
        setError(describeError(e));
        return;
      }
      toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage, undo ? { action: { label: 'Undo', onAction: () => runUndo(undo, { toast, refreshCounts, onDone }) } } : undefined);
      refreshCounts();
      onClose();
      onDone();
    });
  }

  const showInputError = touched && inputError;
  const Field = input?.multiline ? 'textarea' : 'input';
  // The safe choice gets focus first in a destructive dialog without a field.
  const focusCancel = !input && tone === 'danger';

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-desc` : undefined} {...dialogProps}>
      <form className="dialog-body" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <h2 id={`${id}-title`} className="dialog-question">
          {title}
        </h2>
        {description ? (
          <div id={`${id}-desc`} className="stack-sm">
            {description}
          </div>
        ) : null}

        {input ? (
          <div className="field">
            <label htmlFor={`${id}-text`}>{input.label}</label>
            {input.presets?.length ? (
              <div className="chips" role="group" aria-label="Common answers">
                {input.presets.map((preset) => (
                  <button key={preset} type="button" className="chip" aria-pressed={text === preset} onClick={() => setText(preset)} disabled={busy}>
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
              onKeyDown={(e) => {
                // Ctrl/⌘+Enter submits a multi-line reason; plain Enter adds a line.
                if (input.multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
              }}
              aria-invalid={showInputError ? true : undefined}
              aria-describedby={`${id}-hint`}
              readOnly={busy}
              autoFocus
              rows={input.multiline ? 4 : undefined}
            />
            <span id={`${id}-hint`} className={showInputError ? 'field-error' : 'hint'}>
              {showInputError
                ? inputError
                : `${input.hint ?? `${input.limits.min}–${input.limits.max} characters.`}${input.multiline ? ' Ctrl+Enter to submit.' : ''}`}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy} autoFocus={focusCancel}>
            {cancelLabel}
          </button>
          <Button
            type="submit"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            busy={busy}
            busyLabel={busyLabel ?? 'Working…'}
            autoFocus={!input && !focusCancel}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
