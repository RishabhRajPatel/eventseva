import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { keys } from '../lib/queryClient';
import { busyByDay } from '../lib/vendor';
import type { Slot } from '@eventseva/app-shared';

/** Busy slots of a vendor across several months ('YYYY-MM'). */
export function useAvailability(vendorId: string, months: string[]) {
  const results = useQueries({
    queries: months.map((month) => ({
      queryKey: keys.availability(vendorId, month),
      queryFn: () => api.availability(vendorId, month),
      staleTime: 60_000,
    })),
  });
  const busy: { day: string; slot: Slot }[] = results.flatMap((r) => r.data?.busy ?? []);
  return { busy, byDay: busyByDay(busy), isPending: results.some((r) => r.isPending) };
}
