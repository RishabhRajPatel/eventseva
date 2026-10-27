// Confirm dialog (UX.md §4): a question naming the thing, what will happen, and buttons that name the action.
import { createStore } from './store';

export interface ConfirmOptions {
  /** "Delete this video?" */
  title: string;
  /** What will happen, with numbers. */
  body?: string;
  /** Names the action: "Delete video", "Log out". Never "OK". */
  confirmLabel: string;
  /** "Keep" / "Go back". */
  cancelLabel: string;
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export const confirmStore = createStore<Pending | null>(null);

/** Resolves true when the action button is pressed, false on Keep / back / tap outside. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // An older dialog that was never answered counts as "Keep".
  confirmStore.get()?.resolve(false);
  return new Promise((resolve) => {
    confirmStore.set({ ...opts, resolve });
  });
}

export function answerConfirm(ok: boolean) {
  const p = confirmStore.get();
  if (!p) return;
  confirmStore.set(null);
  p.resolve(ok);
}
