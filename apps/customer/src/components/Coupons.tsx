// Coupons on a booking before paying (Payment board), and the offer details shared by Home and Offers.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, rupees, todayIst, type Booking, type Offer } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { haptic } from '../lib/haptics';
import { c, radius, space, TOUCH } from '../lib/theme';
import { useOffers } from '../hooks/useCatalog';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Card, MoneyRow } from './Bits';
import { useBookingUpdated } from './BookingSheets';
import { Button } from './Button';
import { TextField } from './Form';
import { Icon } from './Icon';

/** Codes are 3–20 letters or digits; the server accepts any case, the app shows them in capitals. */
export const cleanCode = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

/** "−₹500" for a discount line. */
export const minus = (paise: number) => `−${rupees(paise)}`;

/** "Valid till 31 Dec 2026" (India date), or null for offers that do not end. */
export function useValidTill() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  return (o: Pick<Offer, 'validUntil'>) => (o.validUntil ? t('offers.validTill', { date: formatDay(todayIst(new Date(o.validUntil)), lang) }) : null);
}

/** The coupon lines in a price box: Advance, Coupon −₹X, then Pay now (or Paid in the app). */
export function CouponMoneyRows({ booking: b, paid }: { booking: Booking; paid?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <MoneyRow label={t('coupon.advance')} value={rupees(b.advancePaise)} />
      <MoneyRow label={t('coupon.line', { code: b.couponCode ?? '' })} value={minus(b.discountPaise)} />
      <MoneyRow label={paid ? t('coupon.paidInApp') : t('coupon.payNow')} value={rupees(b.payNowPaise)} strong accent />
    </>
  );
}

/** "Have a coupon?": enter a code or tap an offer; once applied, shows the discount with Remove. */
export function CouponBox({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const updated = useBookingUpdated();
  const offers = useOffers();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const apply = useMutation({
    mutationFn: (value: string) => api.applyCoupon(b.id, value),
    onSuccess: (next) => {
      haptic.success();
      updated(next);
      setCode('');
      setOpen(false);
    },
    onError: () => haptic.error(),
  });
  const remove = useMutation({ mutationFn: () => api.removeCoupon(b.id), onSuccess: updated });
  const applying = apply.isPending ? apply.variables : null;
  const busy = apply.isPending || remove.isPending;
  const error = apply.error ?? remove.error;
  const errorLine = error ? (
    <AppText size="sm" color={c.danger} accessibilityLiveRegion="assertive">
      {errorText(t, error)}
    </AppText>
  ) : null;

  if (b.couponCode) {
    return (
      <Card style={styles.card}>
        <View style={styles.applied}>
          <Icon name="checkCircle" size={20} color={c.royal} />
          <AppText variant="bold" size="md" style={styles.flex} accessibilityLiveRegion="polite">
            {t('coupon.applied', { code: b.couponCode, amount: rupees(b.discountPaise) })}
          </AppText>
          <Button
            label={t('coupon.remove')}
            variant="outline"
            size="md"
            onPress={() => {
              apply.reset();
              return remove.mutateAsync();
            }}
            style={styles.small}
          />
        </View>
        <AppText size="xs">{t('coupon.note')}</AppText>
        {errorLine}
      </Card>
    );
  }

  const items = offers.data?.items ?? [];
  const valid = code.length >= 3;
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('coupon.have')}
        onPress={() => setOpen((o) => !o)}
        style={styles.toggle}
      >
        <Icon name="star" size={18} color={c.royal} />
        <AppText variant="bold" size="md" color={c.royal} style={styles.flex}>
          {t('coupon.have')}
        </AppText>
        <Icon name={open ? 'close' : 'plus'} size={18} color={c.royal} />
      </Pressable>

      {open ? (
        <View style={styles.inputRow}>
          <View style={styles.flex}>
            <TextField
              label={t('coupon.inputLabel')}
              placeholder={t('coupon.placeholder')}
              hint={t('coupon.hint')}
              value={code}
              onChangeText={(v) => {
                apply.reset();
                remove.reset();
                setCode(cleanCode(v));
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={() => valid && apply.mutate(code)}
            />
          </View>
          <Button
            label={t('coupon.apply')}
            size="md"
            onPress={() => apply.mutate(code)}
            disabled={!valid || remove.isPending}
            loading={applying === code}
            style={styles.applyButton}
          />
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.offers}>
          <AppText variant="bold" size="sm">
            {t('coupon.available')}
          </AppText>
          <View style={styles.chips}>
            {items.map((o) => {
              const on = applying === o.code;
              return (
                <Pressable
                  key={o.code}
                  accessibilityRole="button"
                  accessibilityLabel={t('coupon.applyOffer', { code: o.code, summary: o.summary })}
                  accessibilityState={{ disabled: busy, busy: on, selected: on }}
                  disabled={busy}
                  onPress={() => {
                    haptic.select();
                    remove.reset();
                    apply.mutate(o.code);
                  }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed, busy && !on && styles.chipWaiting]}
                >
                  <View style={styles.chipHead}>
                    {on ? <ActivityIndicator size="small" color={c.royal} /> : <Icon name="star" size={14} color={c.royal} />}
                    <AppText variant="bold" size="sm" color={c.royal}>
                      {o.code}
                    </AppText>
                  </View>
                  <AppText size="xs" numberOfLines={1}>
                    {on ? t('coupon.applying') : o.summary}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {errorLine}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space.lg, gap: space.md },
  applied: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  small: { paddingHorizontal: space.lg },
  toggle: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  // Lines the button up with the input box, under the field label.
  applyButton: { marginTop: 29, height: 52, paddingHorizontal: space.lg },
  offers: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: TOUCH,
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.royal,
    backgroundColor: c.white,
  },
  chipHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chipOn: { borderStyle: 'solid', borderWidth: 2, borderColor: c.selectedBorder, backgroundColor: c.selectedBg },
  chipPressed: { backgroundColor: c.lavender },
  chipWaiting: { opacity: 0.4 },
});
