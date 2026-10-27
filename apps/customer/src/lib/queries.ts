// Shared query options, so prefetching and the screens use the same key, fetcher and freshness.
import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { keys } from './queryClient';

/** How long data counts as fresh (UX.md §7: catalogue 1 h, lists 30 s). */
export const STALE = {
  catalogue: 60 * 60_000,
  vendor: 5 * 60_000,
  offers: 10 * 60_000,
  list: 30_000,
} as const;

export const vendorQuery = (id: string) => ({
  queryKey: keys.vendor(id),
  queryFn: () => api.vendor(id),
  staleTime: STALE.vendor,
});

/** Start loading the vendor page while the finger is still down on a card. */
export function prefetchVendor(qc: QueryClient, id: string) {
  void qc.prefetchQuery(vendorQuery(id));
}
