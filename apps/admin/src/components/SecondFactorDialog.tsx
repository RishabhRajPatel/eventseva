'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import { cleanCode, onSecondFactorRequest, type SecondFactorRequest } from '@/lib/second-factor';

/** Mounted once in the shell: asks for a fresh authenticator code when a sensitive action needs one. */
export function SecondFactorDialog() {
  const [request, setRequest] = useState<SecondFactorRequest | null>(null);
  useEffect(() => onSecondFactorRequest(setRequest), []);
  return request ? <CodeDialog key={request.id} request={request} /> : null;
}

function CodeDialog({ request }: { request: SecondFactorRequest }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const cancel = () => request.answer(null);
  const dialogProps = useModalDialog(ref, { busy: false, onClose: cancel });
  const code = cleanCode(value);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (code) request.answer(code);
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`} {...dialogProps}>
      <form className="dialog-body" onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className="dialog-question">
          Confirm it is you
        </h2>
        <div id={`${id}-desc`} className="stack-sm">
          <p>Money, bank details, exports and blocking need a fresh code from your authenticator app.</p>
          <p className="small muted">After this, other such actions need no code for 5 minutes.</p>
        </div>
        {request.wrong ? (
          <p className="inline-error" role="alert">
            That code was wrong or already used. Wait for the next code in the app, then enter it.
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={`${id}-code`}>6-digit code</label>
          <input
            id={`${id}-code`}
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d\s]/g, ''))}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && !code ? true : undefined}
            aria-describedby={`${id}-hint`}
            autoFocus
          />
          <span id={`${id}-hint`} className={touched && !code ? 'field-error' : 'hint'}>
            {touched && !code ? 'Enter the 6 digits shown in the app.' : 'From Google Authenticator or Authy.'}
          </span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel}>
            Go back
          </button>
          <button type="submit" className="btn btn-primary">
            Confirm
          </button>
        </div>
      </form>
    </dialog>
  );
}
