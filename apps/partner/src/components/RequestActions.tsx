import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { useBookingActions, type AcceptBody } from '../hooks/useBookingActions';
import { checkPrice } from '../lib/money';
import { c, radius, space } from '../lib/theme';
import { Button } from './Button';
import { ChoiceChip } from './Chip';
import { Notice } from './Notice';
import { PriceInput } from './PriceInput';
import { ReasonSheet } from './ReasonSheet';
import { Txt } from './Txt';

/** Extras the customer asked for that need the vendor's yes or no before accepting. */
export const pendingAddons = (b: Pick<Booking, 'addons'>) => (b.addons ?? []).filter((a) => a.status === 'pending_approval');
/** A custom quotation (planner) or undecided extras: accepting asks first. */
export const needsDecision = (b: Pick<Booking, 'bookingType' | 'addons'>) => b.bookingType === 'quote' || pendingAddons(b).length > 0;

/** Decline / Accept for a new request. Declining asks for a reason, which the customer sees. */
export function RequestActions({ bookingId, booking }: { bookingId: string; booking?: Booking }) {
  const { t } = useTranslation();
  const { accept, reject } = useBookingActions(bookingId);
  const [declining, setDeclining] = useState(false);
  const [deciding, setDeciding] = useState(false);
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
          if (busy) return;
          if (booking && needsDecision(booking)) setDeciding(true);
          else accept.mutate(undefined);
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
      {booking ? (
        <AcceptSheet
          visible={deciding}
          booking={booking}
          loading={accept.isPending}
          onClose={() => setDeciding(false)}
          onConfirm={(body) => {
            if (!accept.isPending) accept.mutate(body, { onSuccess: () => setDeciding(false) });
          }}
        />
      ) : null}
    </View>
  );
}

/** Before accepting: the price for a custom quotation, and a yes / no on each extra asked for. */
function AcceptSheet({ visible, booking: b, loading, onConfirm, onClose }: { visible: boolean; booking: Booking; loading: boolean; onConfirm: (body: AcceptBody) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const extras = pendingAddons(b);
  const [price, setPrice] = useState('');
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (visible) {
      setPrice('');
      setAnswers({});
      setTried(false);
    }
  }, [visible]);

  const isQuote = b.bookingType === 'quote';
  const priceCheck = checkPrice(price);
  const undecided = extras.filter((a) => answers[a.addonId] === undefined);
  const valid = (!isQuote || priceCheck.ok) && undecided.length === 0;

  function submit() {
    setTried(true);
    if (!valid) return;
    onConfirm({
      ...(isQuote && priceCheck.ok ? { pricePaise: priceCheck.paise } : {}),
      ...(extras.length ? { addons: extras.map((a) => ({ addonId: a.addonId, approve: answers[a.addonId]! })) } : {}),
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} testID="accept-sheet">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.lg }}>
          <Txt variant="display" size="xl">
            {t('requests.acceptTitle')}
          </Txt>
          {isQuote ? (
            <View style={{ gap: space.sm }}>
              <Notice tone="info">{t('requests.quoteNote')}</Notice>
              <PriceInput testID="quote-price" label={t('requests.yourPrice')} value={price} onChange={setPrice} showError={tried} />
            </View>
          ) : null}
          {extras.map((a) => (
            <View key={a.addonId} style={{ gap: space.xs }} testID={`decide-addon-${a.addonId}`}>
              <Txt variant="bold" size="md">
                {`${a.name} · ${rupees(a.pricePaise)}`}
              </Txt>
              {a.note ? <Txt size="sm" color={c.textMuted}>{`“${a.note}”`}</Txt> : null}
              <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={a.name}>
                <ChoiceChip testID={`addon-yes-${a.addonId}`} label={t('requests.addonYes')} selected={answers[a.addonId] === true} onPress={() => setAnswers({ ...answers, [a.addonId]: true })} />
                <ChoiceChip testID={`addon-no-${a.addonId}`} label={t('requests.addonNo')} selected={answers[a.addonId] === false} onPress={() => setAnswers({ ...answers, [a.addonId]: false })} />
              </View>
            </View>
          ))}
          {tried && undecided.length ? (
            <Txt size="sm" color={c.danger} accessibilityRole="alert">
              {t('requests.decideEachExtra')}
            </Txt>
          ) : null}
          <Button testID="confirm-accept" icon="check" label={t('requests.accept')} loadingLabel={t('requests.accepting')} loading={loading} onPress={submit} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, maxHeight: '90%', width: '100%', maxWidth: 640, alignSelf: 'center' },
});
