// The venue: address, a landmark, and a pin (from the address, or "I am at the venue now").
// With a pin, both sides see how far the vendor travels, and the vendor gets directions once paid.
import { forwardRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { pinUrl, type LatLng } from '@eventseva/app-shared';
import { addressOf, currentPin, findAddress, LocationError } from '../lib/location';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { FieldError, TextField } from './Form';
import { Icon } from './Icon';
import { openLink } from '../lib/links';

export interface Venue {
  address: string;
  landmark: string;
  pin: LatLng | null;
}

export const VenuePicker = forwardRef<TextInputInstance, {
  value: Venue;
  onChange: (v: Venue) => void;
  addressError?: string | null;
  onBlurAddress?: () => void;
}>(function VenuePicker({ value, onChange, addressError, onBlurAddress }, ref) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'find' | 'here' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<Venue>) => onChange({ ...value, ...patch });

  /** false = not done, so the button gives the error haptic (UX.md §3). */
  async function locate(how: 'find' | 'here'): Promise<boolean> {
    if (busy) return false;
    setBusy(how);
    setProblem(null);
    try {
      const pin = how === 'here' ? await currentPin() : await findAddress(value.address.trim());
      // Standing at the venue with an empty address: fill it in from the pin.
      const address = how === 'here' && !value.address.trim() ? ((await addressOf(pin)) ?? '') : value.address;
      onChange({ ...value, address, pin });
      return true;
    } catch (e) {
      setProblem(t(`venue.problems.${e instanceof LocationError ? e.problem : 'failed'}`));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.wrap} testID="venue-picker">
      <TextField
        ref={ref}
        label={t('event.venue')}
        placeholder={t('event.venuePlaceholder')}
        value={value.address}
        // A new address means the old pin may be wrong.
        onChangeText={(address) => set({ address, pin: address.trim() === value.address.trim() ? value.pin : null })}
        onBlur={onBlurAddress}
        maxLength={300}
        error={addressError}
      />
      <TextField
        label={t('venue.landmark')}
        placeholder={t('venue.landmarkPlaceholder')}
        value={value.landmark}
        onChangeText={(landmark) => set({ landmark })}
        maxLength={120}
      />
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button
            testID="venue-find"
            label={t('venue.find')}
            icon="pin"
            variant="outline"
            size="md"
            disabled={value.address.trim().length < 5 || busy === 'here'}
            loading={busy === 'find'}
            loadingLabel={t('venue.finding')}
            onPress={() => locate('find')}
          />
        </View>
        <View style={styles.flex}>
          <Button
            testID="venue-here"
            label={t('venue.here')}
            icon="locate"
            variant="outline"
            size="md"
            disabled={busy === 'find'}
            loading={busy === 'here'}
            loadingLabel={t('venue.locating')}
            onPress={() => locate('here')}
          />
        </View>
      </View>
      {value.pin ? (
        <View style={[styles.status, styles.ok]} testID="venue-pinned">
          <Icon name="checkCircle" size={18} color={c.successText} />
          <AppText size="sm" color={c.successText} style={styles.flex}>
            {t('venue.pinned')}
          </AppText>
          <Button label={t('venue.check')} variant="ghost" size="md" onPress={() => openLink(pinUrl(value.pin!))} />
          <Button label={t('venue.remove')} variant="ghost" size="md" onPress={() => set({ pin: null })} />
        </View>
      ) : (
        <View style={[styles.status, styles.hint]}>
          <Icon name="pin" size={18} color={c.royal} />
          <AppText size="sm" style={styles.flex}>
            {t('venue.whyPin')}
          </AppText>
        </View>
      )}
      <FieldError>{problem}</FieldError>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', gap: space.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, flexWrap: 'wrap' },
  ok: { backgroundColor: c.mintLight },
  hint: { backgroundColor: c.lavender },
});
