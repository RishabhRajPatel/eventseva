'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error';

export interface ToastAction {
  /** "Undo" */
  label: string;
  onAction: () => void;
}

interface ToastOptions {
  /** One button next to the text, e.g. Undo for a reversible change (UX.md §4). */
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
  action?: ToastAction;
}

interface ToastApi {
  success: (text: string, options?: ToastOptions) => void;
  error: (text: string) => void;
}

/** Errors stay longer: they usually need reading. Undo gets the 5 s from UX.md §4. */
const DURATION: Record<Kind, number> = { success: 5000, error: 9000 };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

/** Feedback after every action. Lives in the shell, so it survives navigation between pages. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((kind: Kind, text: string, action?: ToastAction) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-2), { id, kind, text, action }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ success: (t, o) => push('success', t, o?.action), error: (t) => push('error', t) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** One toast. Its timer pauses while the pointer or keyboard focus is on it, so Undo stays reachable. */
function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(item.id), DURATION[item.kind]);
    return () => window.clearTimeout(timer);
  }, [paused, item.id, item.kind, onDismiss]);

  return (
    <div
      className={`toast toast-${item.kind}`}
      role={item.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-text">
        <span className="toast-icon" aria-hidden="true">
          {item.kind === 'success' ? '✓' : '!'}
        </span>
        <span>{item.text}</span>
      </span>
      <span className="toast-buttons">
        {item.action ? (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              onDismiss(item.id);
              item.action!.onAction();
            }}
          >
            {item.action.label}
          </button>
        ) : null}
        <button type="button" onClick={() => onDismiss(item.id)} aria-label="Dismiss">
          ×
        </button>
      </span>
    </div>
  );
}
