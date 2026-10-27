import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorCode, errorText } from '../lib/errors';
import { invalidateBookings, keys } from '../lib/queries';
import { toast } from '../lib/toast';

export interface AcceptBody {
  pricePaise?: number;
  addons?: { addonId: string; approve: boolean }[];
}

/** Accept / reject / cancel one booking, with a toast for the result and refreshed lists. */
export function useBookingActions(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const done = (message: string) => (b: Booking) => {
    qc.setQueryData(keys.booking(id), b);
    invalidateBookings(qc, id);
    toast.success(message);
  };
  const onError = (e: unknown) => {
    // The booking changed under us (expired, slot taken): refresh so the screen shows the truth.
    if (['BOOKING_EXPIRED', 'BOOKING_BAD_STATUS', 'SLOT_TAKEN'].includes(errorCode(e) ?? '')) invalidateBookings(qc, id);
    toast.error(errorText(t, e));
  };

  // Engine bookings may need the vendor's price (custom quotation) and a yes / no on each extra.
  const accept = useMutation({
    mutationFn: (body?: AcceptBody) => (body ? api.post<Booking>(`/v1/partner/bookings/${id}/accept`, body) : api.post<Booking>(`/v1/partner/bookings/${id}/accept`)),
    onSuccess: done(t('requests.accepted')),
    onError,
  });
  const reject = useMutation({ mutationFn: (reason: string) => api.post<Booking>(`/v1/partner/bookings/${id}/reject`, { reason }), onSuccess: done(t('requests.declined')), onError });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post<Booking>(`/v1/partner/bookings/${id}/cancel`, { reason }), onSuccess: done(t('booking.cancelled')), onError });
  // Event day: tell the customer you are on the way (with minutes) or have reached.
  const progress = useMutation({
    mutationFn: (p: { status: 'on_the_way' | 'reached'; etaMinutes?: number }) => api.post<Booking>(`/v1/partner/bookings/${id}/progress`, p),
    onSuccess: (b, p) => done(p.status === 'reached' ? t('trip.reachedSent') : t('trip.onTheWaySent'))(b),
    onError,
  });
  return { accept, reject, cancel, progress };
}
