// Is the API reachable? There is no netinfo package, so the API client reports it: a fetch that
// throws (no network, DNS, timeout) means offline; any answer from the server means online.
import { useSyncExternalStore } from 'react';

let online = true;
const listeners = new Set<() => void>();

export const isOnline = () => online;

export function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l());
}

export function subscribeNetwork(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeNetwork, isOnline, isOnline);
}

/** A fetch for the API client that records reachability on every request. */
export function trackingFetch(base?: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      const res = await (base ?? globalThis.fetch)(input, init);
      setOnline(true);
      return res;
    } catch (e) {
      setOnline(false);
      throw e;
    }
  };
}
