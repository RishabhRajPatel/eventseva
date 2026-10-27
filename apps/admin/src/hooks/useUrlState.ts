'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { toQueryString } from '@/lib/labels';

type Updates = Record<string, string | number | boolean | null | undefined>;

/**
 * Filters and paging live in the URL, so a filtered list can be shared and survives a reload.
 * Changing a filter goes back to page 1 unless the update sets the page itself.
 */
export function useUrlState() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const hrefWith = useCallback(
    (updates: Updates) => {
      const next: Updates = Object.fromEntries(searchParams.entries());
      if (!('page' in updates)) delete next.page;
      return pathname + toQueryString({ ...next, ...updates });
    },
    [pathname, searchParams],
  );

  /** `replace` for typing in a search box, so Back does not step through every letter. */
  const set = useCallback(
    (updates: Updates, options: { replace?: boolean } = {}) => {
      const href = hrefWith(updates);
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router, hrefWith],
  );

  return { params: searchParams, hrefWith, set };
}
