// Debounce for search boxes: the API is called once the admin stops typing for a moment.

export const SEARCH_DEBOUNCE_MS = 300;

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Runs a pending call now (Enter in a search box). */
  flush(): void;
  /** Drops a pending call (unmount). */
  cancel(): void;
  pending(): boolean;
}

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Calls `fn` with the latest arguments once `ms` have passed without another call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number, timers: Timers = defaultTimers): Debounced<A> {
  let timer: unknown = null;
  let lastArgs: A | null = null;

  const run = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(run, ms);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer === null) return;
    timers.clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}
