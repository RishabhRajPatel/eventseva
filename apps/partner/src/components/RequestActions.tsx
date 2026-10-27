import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useBookingActions } from '../hooks/useBookingActions';
import { space } from '../lib/theme';
import { Button } from './Button';
import { ReasonSheet } from './ReasonSheet';

/** Decline / Accept for a new request. Declining asks for a reason, which the customer sees. */
export function RequestActions({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const { accept, reject } = useBookingActions(bookingId);
  const [declining, setDeclining] = useState(false);
  const busy = accept.isPending || reject.isPending;
  return (
    <View style={styles.row}>
      <Button testID="decline" kind="outline" label={t('requests.decline')} onPress={() => setDeclining(true)} style={styles.flex} disabled={busy} />
      <Button
        testID="accept"
        icon="check"
        label={t('requests.accept')}
        loadingLabel={t('requests.accepting')}
        onPress={() => {
          if (!busy) accept.mutate();
        }}
        loading={accept.isPending}
        disabled={reject.isPending}
        style={styles.flex}
      />
      <ReasonSheet
        visible={declining}
        title={t('requests.declineTitle')}
        message={t('requests.declineBody')}
        quickReasons={[t('reason.alreadyBooked'), t('reason.notAvailable'), t('reason.tooFar'), t('reason.notOffered')]}
        confirmLabel={t('requests.declineConfirm')}
        loading={reject.isPending}
        onClose={() => setDeclining(false)}
        onConfirm={(reason) => {
          if (!reject.isPending) reject.mutate(reason, { onSuccess: () => setDeclining(false) });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
