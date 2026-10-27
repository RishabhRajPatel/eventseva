'use client';
import { useCallback, useEffect, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A native modal <dialog> that follows UX.md §4 / §8: opens on mount, Esc closes (unless busy),
 * Tab stays inside, and focus goes back to the button that opened it (or the main content if that
 * button is gone, e.g. "Approve" after approving).
 */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, { busy, onClose }: { busy: boolean; onClose: () => void }) {
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    // Closed when the page is hidden by navigation (Activity) or unmounted; re-opened on return.
    return () => {
      dialog?.close();
      // The opener may sit in another open dialog (Approve inside the photo preview): that is fine.
      const ownerDialog = opener?.closest('dialog');
      const usable = opener?.isConnected && (!ownerDialog || ownerDialog.open);
      const target = usable ? opener : document.getElementById('content');
      target?.focus({ preventScroll: true });
    };
  }, [ref]);

  const onCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      if (!busy) onClose();
    },
    [busy, onClose],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return { onCancel, onKeyDown };
}
