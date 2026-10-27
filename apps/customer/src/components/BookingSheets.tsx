// Cancel (a confirm dialog with the refund estimate) and the review sheet on the booking page.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { refundPreview } from '../lib/booking';
import { errorText } from '../lib/errors';
import { haptic } from '../lib/haptics';
import { keys } from '../lib/queryClient';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Notice } from './Bits';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { FieldError, TextField } from './Form';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

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

const MIN_REASON = 3;

/**
 * "Cancel your booking with Raj DJ?": what happens (refund estimate with numbers), a reason for the
 * vendor, then a red "Yes, cancel booking" and "Keep booking" (UX.md §4).
 */
export function CancelDialog({ booking, visible, onClose }: { booking: Booking; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const updated = useBookingUpdated();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const cancel = useMutation({ mutationFn: () => api.cancelBooking(booking.id, reason.trim()) });

  async function confirm() {
    if (reason.trim().length < MIN_REASON) {
      setReasonError(t('cancel.reasonShort'));
      return false;
    }
    const b = await cancel.mutateAsync();
    updated(b);
    onClose();
    toast.success(b.refundPaise > 0 ? t('cancel.doneRefund', { amount: rupees(b.refundPaise) }) : t('cancel.done'));
  }

  const close = () => {
    cancel.reset();
    setReasonError(null);
    onClose();
  };

  return (
    <ConfirmDialog
      visible={visible}
      destructive
      title={t('cancel.title', { name: booking.vendor.businessName })}
      confirmLabel={t('cancel.confirm')}
      cancelLabel={t('cancel.keep')}
      busyLabel={t('cancel.busy')}
      error={cancel.error ? errorText(t, cancel.error) : null}
      onConfirm={confirm}
      onCancel={close}
    >
      <RefundText booking={booking} />
      <AppText size="sm">{t('cancel.policy')}</AppText>
      <TextField
        label={t('cancel.reason')}
        placeholder={t('cancel.reasonPlaceholder')}
        value={reason}
        onChangeText={(v) => {
          setReason(v);
          if (reasonError && v.trim().length >= MIN_REASON) setReasonError(null);
        }}
        onBlur={() => reason.trim() && reason.trim().length < MIN_REASON && setReasonError(t('cancel.reasonShort'))}
        multiline
        maxLength={300}
        error={reasonError}
      />
    </ConfirmDialog>
  );
}

export function ReviewSheet({ booking, visible, onClose, onDone }: { booking: Booking; visible: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingError, setRatingError] = useState<string | null>(null);
  const review = useMutation({ mutationFn: () => api.review(booking.id, rating, comment.trim() || undefined) });

  async function submit() {
    if (rating === 0) {
      setRatingError(t('review.pickStars'));
      return false;
    }
    await review.mutateAsync();
    onDone();
    onClose();
    toast.success(t('review.posted'));
  }

  return (
    <Sheet visible={visible} title={t('review.title', { name: booking.vendor.businessName })} onClose={onClose}>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={t('review.rating')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: rating === n, selected: rating === n }}
            accessibilityLabel={t('review.stars', { count: n })}
            onPress={() => {
              haptic.select();
              setRating(n);
              setRatingError(null);
            }}
            style={({ pressed }) => [styles.star, rating === n && styles.starOn, pressed && styles.pressed]}
          >
            <Icon name="star" size={32} color={n <= rating ? c.royal : c.outline} fill={n <= rating ? c.royal : 'none'} />
          </Pressable>
        ))}
      </View>
      <FieldError>{ratingError}</FieldError>
      <TextField
        label={t('review.comment')}
        placeholder={t('review.commentPlaceholder')}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={1000}
        error={review.error ? errorText(t, review.error) : null}
      />
      <Button label={t('review.submit')} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', justifyContent: 'center', gap: space.xs },
  star: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26 },
  starOn: { backgroundColor: c.selectedBg },
  pressed: { opacity: 0.85 },
});
