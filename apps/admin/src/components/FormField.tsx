'use client';
import { cloneElement, useCallback, useState, type FocusEvent, type ReactElement, type ReactNode } from 'react';

interface ControlProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Label + one input/select + its hint or error. Gives the control its id, aria-invalid and
 * aria-describedby, so the error is read out with the field.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactElement<ControlProps>;
}) {
  const msgId = `${id}-msg`;
  const control = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? msgId : undefined,
  });
  return (
    <div className="field" data-invalid={error ? 'true' : undefined}>
      <label htmlFor={id}>{label}</label>
      {control}
      {error ? (
        <span id={msgId} className="field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Puts the cursor in the first field with an error (after a failed submit, UX.md §3). */
export function focusFirstError(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[data-invalid="true"] :is(input, select, textarea)')?.focus());
}

/**
 * Validate as the admin leaves a field, and everything on submit (UX.md §3).
 * Spread `onBlur` on the <form>; `show(id)` says whether that field's error may be shown.
 */
export function useFormErrors() {
  const [tried, setTried] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const onBlur = useCallback((event: FocusEvent<HTMLFormElement>) => {
    const id = (event.target as HTMLElement).id;
    if (id) setTouched((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const reset = useCallback(() => {
    setTried(false);
    setTouched(new Set());
  }, []);
  const show = useCallback((id: string) => tried || touched.has(id), [tried, touched]);
  return { tried, setTried, onBlur, show, reset };
}
