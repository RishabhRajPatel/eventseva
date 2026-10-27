import { useCallback, useRef, useState } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance, TextInputInstance } from 'react-native';
import { haptic } from '../lib/haptics';

/**
 * Form feedback from UX.md §3: a field shows its error once the vendor leaves it, every error
 * shows after Submit, and a failed Submit scrolls to and focuses the first wrong field.
 * Wrap each field in `<View {...form.at('title')}>` (a direct child of the Screen content).
 */
export function useForm<K extends string>(order: readonly K[]) {
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const ys = useRef<Partial<Record<K, number>>>({});
  const inputs = useRef<Partial<Record<K, TextInputInstance | null>>>({});
  const [touched, setTouched] = useState<ReadonlySet<K>>(new Set());
  const [tried, setTried] = useState(false);

  const at = useCallback(
    (k: K) => ({
      onLayout: (e: LayoutChangeEvent) => {
        ys.current[k] = e.nativeEvent.layout.y;
      },
    }),
    [],
  );
  const ref = useCallback(
    (k: K) => (el: TextInputInstance | null) => {
      inputs.current[k] = el;
    },
    [],
  );
  const blur = useCallback((k: K) => () => setTouched((s) => (s.has(k) ? s : new Set(s).add(k))), []);
  const show = (k: K) => tried || touched.has(k);

  /** Call on Submit with the current errors; returns true when the form is fine. */
  const check = (errors: Partial<Record<K, unknown>>) => {
    setTried(true);
    const first = order.find((k) => errors[k]);
    if (!first) return true;
    haptic.error();
    scrollRef.current?.scrollTo({ y: Math.max(0, (ys.current[first] ?? 0) - 16), animated: true });
    inputs.current[first]?.focus?.();
    return false;
  };

  return { scrollRef, at, ref, blur, show, check, tried };
}
