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
  return (
    <View style={styles.row}>
      <Button testID="decline" kind="outline" label={t('requests.decline')} onPress={() => setDeclining(true)} style={styles.flex} disabled={accept.isPending} />
      <Button testID="accept" label={t('requests.accept')} onPress={() => accept.mutate()} loading={accept.isPending} style={styles.flex} />
      <ReasonSheet
        visible={declining}
        title={t('requests.declineTitle')}
        quickReasons={[t('reason.alreadyBooked'), t('reason.notAvailable'), t('reason.tooFar'), t('reason.notOffered')]}
        confirmLabel={t('requests.decline')}
        loading={reject.isPending}
        onClose={() => setDeclining(false)}
        onConfirm={(reason) => reject.mutate(reason, { onSuccess: () => setDeclining(false) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
