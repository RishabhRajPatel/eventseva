'use client';
import { describeError } from '@/lib/errors';
import type { ShellValue } from './ShellContext';

/** For reversible changes: the success toast offers Undo for 5 s (UX.md §4). */
export interface UndoSpec {
  run: () => Promise<unknown>;
  /** Toast after a successful undo: "Coupon SHAADI10 is active again." */
  message: string;
}

/** Runs an Undo from a toast and reports the result in a new toast. */
export async function runUndo(undo: UndoSpec, { toast, refreshCounts, onDone }: Pick<ShellValue, 'toast' | 'refreshCounts'> & { onDone: () => void }) {
  try {
    await undo.run();
    toast.success(undo.message);
  } catch (e) {
    toast.error(`Could not undo. ${describeError(e)}`);
  } finally {
    refreshCounts();
    onDone();
  }
}
