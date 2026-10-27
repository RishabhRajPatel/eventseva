// Bottom toast / snackbar (UX.md §3): results of an action, with an optional Undo.
import { AccessibilityInfo } from 'react-native';
import { haptic } from './haptics';
import { createStore } from './store';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** e.g. Undo. Pressing it closes the toast. */
  action?: { label: string; onPress: () => void };
  /** ms; 3 s by default, 5 s when there is an action. */
  duration?: number;
  testID?: string;
}

export interface ToastState extends ToastOptions {
  id: number;
  duration: number;
}

export const toastStore = createStore<ToastState | null>(null);

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function clear() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function hideToast(id?: number) {
  if (id !== undefined && toastStore.get()?.id !== id) return;
  clear();
  toastStore.set(null);
}

/** Shows one toast (a new one replaces the old) and plays the matching haptic. */
export function showToast(opts: ToastOptions | string): number {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  const tone = o.tone ?? 'success';
  const duration = o.duration ?? (o.action ? 5000 : 3000);
  const id = nextId++;
  clear();
  toastStore.set({ ...o, tone, duration, id });
  timer = setTimeout(() => hideToast(id), duration);
  if (tone === 'success') haptic.success();
  else if (tone === 'error') haptic.error();
  try {
    AccessibilityInfo.announceForAccessibility?.(o.message);
  } catch {
    // Not available in every environment.
  }
  return id;
}

export const toast = {
  show: showToast,
  success: (message: string, extra: Omit<ToastOptions, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'success' }),
  error: (message: string, extra: Omit<ToastOptions, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'error' }),
  info: (message: string, extra: Omit<ToastOptions, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'info' }),
  hide: hideToast,
};
