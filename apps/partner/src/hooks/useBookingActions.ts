import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorCode, errorText } from '../lib/errors';
import { invalidateBookings, keys } from '../lib/queries';

/** Accept / reject / cancel one booking, with the right messages and refreshed lists. */
export function useBookingActions(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const onSuccess = (b: Booking) => {
    qc.setQueryData(keys.booking(id), b);
    invalidateBookings(qc, id);
  };
  const onError = (e: unknown) => {
    // The booking changed under us (expired, slot taken): refresh so the screen shows the truth.
    if (['BOOKING_EXPIRED', 'BOOKING_BAD_STATUS', 'SLOT_TAKEN'].includes(errorCode(e) ?? '')) invalidateBookings(qc, id);
    Alert.alert(t('errors.title'), errorText(t, e));
  };

  const accept = useMutation({ mutationFn: () => api.post<Booking>(`/v1/partner/bookings/${id}/accept`), onSuccess, onError });
  const reject = useMutation({ mutationFn: (reason: string) => api.post<Booking>(`/v1/partner/bookings/${id}/reject`, { reason }), onSuccess, onError });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post<Booking>(`/v1/partner/bookings/${id}/cancel`, { reason }), onSuccess, onError });
  return { accept, reject, cancel };
}
