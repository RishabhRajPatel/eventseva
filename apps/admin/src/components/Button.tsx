'use client';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Request in flight: shows a spinner, ignores clicks, keeps focus (aria-disabled, not disabled). */
  busy?: boolean;
  /** Label while busy ("Saving…"); defaults to the normal label. */
  busyLabel?: ReactNode;
};

/**
 * Every async button in the panel (UX.md §3): its own spinner, busy and unclickable until the request
 * ends. Handlers must still guard against double submits (useBusy), because Enter in a form submits
 * without a click.
 */
export function Button({ busy = false, busyLabel, children, className = 'btn', type = 'button', onClick, ...rest }: Props) {
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }
  return (
    <button {...rest} type={type} className={className} onClick={click} aria-busy={busy || undefined} aria-disabled={busy || rest['aria-disabled'] || undefined}>
      {busy ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
