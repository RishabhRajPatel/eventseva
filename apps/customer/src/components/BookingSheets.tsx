// Cancel (with refund preview) and review sheets on the booking page.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { refundPreview } from '../lib/booking';
import { errorText } from '../lib/errors';
import { keys } from '../lib/queryClient';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Notice } from './Bits';
import { Button } from './Button';
import { TextField } from './Form';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** Put a booking the server returned into the cache, and refresh the lists that show it. */
export function useBookingUpdated() {
  const qc = useQueryClient();
  return (b: Booking) => {
    qc.setQueryData(keys.booking(b.id), b);
    void qc.invalidateQueries({ queryKey: keys.allBookings });
    void qc.invalidateQueries({ queryKey: keys.events });
  };
}

/** The refund line shown before confirming a cancel. The server decides the real amount. */
export function RefundText({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  const p = refundPreview(booking);
  if (!p) return null;
  if (!p.paid) return <Notice icon="checkCircle" tone="mintLight">{t('cancel.notPaid')}</Notice>;
  return (
    <Notice icon="alert" tone={p.percent > 0 ? 'mintLight' : 'peach'}>
      <AppText variant="bold" size="md">
        {p.percent === 0
          ? t('cancel.noRefund')
          : booking.discountPaise > 0
            ? t('cancel.refundPaid', { amount: rupees(p.refundPaise), percent: p.percent, paid: rupees(booking.payNowPaise) })
            : t('cancel.refund', { amount: rupees(p.refundPaise), percent: p.percent })}
      </AppText>
      <AppText size="sm">{t('cancel.daysBefore', { count: p.daysBefore })}</AppText>
      <AppText size="xs">{t('cancel.estimateNote')}</AppText>
    </Notice>
  );
}

export function CancelSheet({ booking, visible, onClose }: { booking: Booking; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const updated = useBookingUpdated();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.cancelBooking(booking.id, reason.trim()),
    onSuccess: (b) => {
      updated(b);
      onClose();
    },
  });
  const tooShort = reason.trim().length < 3;
  return (
    <Sheet visible={visible} title={t('cancel.title')} onClose={onClose}>
      <RefundText booking={booking} />
      <AppText size="sm">{t('cancel.policy')}</AppText>
      <TextField
        label={t('cancel.reason')}
        placeholder={t('cancel.reasonPlaceholder')}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={300}
        error={cancel.error ? errorText(t, cancel.error) : null}
      />
      <Button label={t('cancel.confirm')} variant="danger" onPress={() => cancel.mutate()} disabled={tooShort} loading={cancel.isPending} />
      <Button label={t('cancel.keep')} variant="outline" onPress={onClose} />
    </Sheet>
  );
}

export function ReviewSheet({ booking, visible, onClose, onDone }: { booking: Booking; visible: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: () => api.review(booking.id, rating, comment.trim() || undefined),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Sheet visible={visible} title={t('review.title', { name: booking.vendor.businessName })} onClose={onClose}>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={t('review.rating')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: rating === n }}
            accessibilityLabel={t('review.stars', { count: n })}
            onPress={() => setRating(n)}
            style={styles.star}
          >
            <Icon name="star" size={32} color={n <= rating ? c.royal : c.lilac} fill={n <= rating ? c.royal : 'none'} />
          </Pressable>
        ))}
      </View>
      <TextField
        label={t('review.comment')}
        placeholder={t('review.commentPlaceholder')}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={1000}
        error={review.error ? errorText(t, review.error) : null}
      />
      <Button label={t('review.submit')} onPress={() => review.mutate()} disabled={rating === 0} loading={review.isPending} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', justifyContent: 'center', gap: space.xs },
  star: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
