// Inputs for engine bookings: a vendor's question (menu, occasion …) and a pickup / drop place for cars.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FieldDef, Place } from '@eventseva/app-shared';
import { formatClock } from '@eventseva/app-shared';
import { fieldLabel } from '../lib/engine';
import { LicencePhotoError, pickAndUploadAnswerPhoto } from '../lib/licencePhoto';
import { DatePicker } from './DatePicker';
import { currentPin, findAddress, LocationError } from '../lib/location';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from './AppText';
import { Button } from './Button';
import { Chip, FieldError, TextField } from './Form';
import { Icon } from './Icon';

/** One question from the vendor's category, in the app language. */
export function AnswerField({ field: f, value, onChange, error }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: 'required' | 'invalid' | null }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const label = fieldLabel(f, lang) + (f.required ? '' : ` ${t('engineBook.optional')}`);
  const message = error === 'required' ? t('engineBook.answerRequired') : error === 'invalid' ? t('engineBook.answerInvalid') : null;

  const help = f.help ? (lang === 'hi' ? f.help.hi : f.help.en) : null;
  if (f.type === 'photo') return <PhotoAnswer label={label} help={help} value={value} onChange={onChange} message={message} testID={`answer-${f.key}`} />;
  if (f.type === 'date') {
    return (
      <View style={styles.group}>
        <AppText variant="bold" size="sm">{label}</AppText>
        {help ? <AppText size="xs" color={c.textMuted}>{help}</AppText> : null}
        <DatePicker value={typeof value === 'string' ? value : null} onChange={(d) => onChange(d)} />
        <FieldError>{message}</FieldError>
      </View>
    );
  }
  if (f.type === 'time') {
    return (
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <AppText variant="bold" size="sm">{label}</AppText>
        {help ? <AppText size="xs" color={c.textMuted}>{help}</AppText> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {HALF_HOURS.map((time) => (
            <Chip key={time} label={formatClock(time)} selected={value === time} role="radio" onPress={() => onChange(value === time && !f.required ? undefined : time)} />
          ))}
        </ScrollView>
        <FieldError>{message}</FieldError>
      </View>
    );
  }
  if (f.type === 'text' || f.type === 'longtext' || f.type === 'number') {
    const text = f.type === 'text' || f.type === 'longtext';
    return (
      <View style={styles.group}>
        <TextField
          label={label}
          value={value === undefined || value === null ? '' : String(value)}
          onChangeText={(v) => onChange(f.type === 'number' ? v.replace(/[^\d.]/g, '') : v)}
          keyboardType={f.type === 'number' ? 'number-pad' : 'default'}
          maxLength={text ? f.maxLength ?? (f.type === 'longtext' ? 2000 : 500) : 10}
          multiline={f.type === 'longtext' || (f.type === 'text' && (f.maxLength ?? 500) > 200)}
          error={message}
        />
        {help ? <AppText size="xs" color={c.textMuted}>{help}</AppText> : null}
      </View>
    );
  }
  const options =
    f.type === 'boolean'
      ? [
          { value: true as unknown, label: t('engineBook.yes') },
          { value: false as unknown, label: t('engineBook.no') },
        ]
      : (f.options ?? []).map((o) => ({ value: o.value as unknown, label: lang === 'hi' ? o.label.hi : o.label.en }));
  const multi = f.type === 'multiselect';
  const isOn = (v: unknown) => (multi ? Array.isArray(value) && value.includes(v) : value === v);
  const toggle = (v: unknown) => {
    if (!multi) return onChange(value === v && !f.required ? undefined : v);
    const list = Array.isArray(value) ? value : [];
    onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };
  return (
    <View style={styles.group} accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={label}>
      <AppText variant="bold" size="sm">
        {label}
      </AppText>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} selected={isOn(o.value)} role={multi ? 'checkbox' : 'radio'} onPress={() => toggle(o.value)} />
        ))}
      </View>
      {help ? <AppText size="xs" color={c.textMuted}>{help}</AppText> : null}
      <FieldError>{message}</FieldError>
    </View>
  );
}

/** 06:00 to 23:30 every half hour, India time. */
const HALF_HOURS = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/** A photo answer: picked from the phone and uploaded privately; the answer is Cloudinary's signed reply. */
function PhotoAnswer({ label, help, value, onChange, message, testID }: { label: string; help: string | null; value: unknown; onChange: (v: unknown) => void; message: string | null; testID: string }) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);
  const attached = !!value && typeof value === 'object';
  async function attach() {
    setProblem(null);
    try {
      const photo = await pickAndUploadAnswerPhoto();
      if (photo) onChange(photo);
    } catch (e) {
      setProblem(e instanceof LicencePhotoError && e.code === 'FILE_TOO_BIG' ? t('engineBook.photoTooBig') : t('engineBook.photoFailed'));
    }
  }
  return (
    <View style={styles.group}>
      <AppText variant="bold" size="sm">{label}</AppText>
      {help ? <AppText size="xs" color={c.textMuted}>{help}</AppText> : null}
      {attached ? <AppText size="sm" color={c.textMuted}>{t('engineBook.photoAttached')}</AppText> : null}
      <Button testID={testID} variant="outline" size="md" icon="camera" label={attached ? t('engineBook.photoChange') : t('engineBook.photoAttach')} onPress={attach} />
      {attached ? <Button variant="ghost" size="md" label={t('engineBook.photoRemove')} onPress={() => onChange(undefined)} /> : null}
      <FieldError>{problem ?? message}</FieldError>
    </View>
  );
}

/** A place found from its address, or "I am here now"; the server needs the pin to work out the distance. */
export function PlaceField({ label, value, onChange, testID }: { label: string; value: Place | null; onChange: (p: Place | null) => void; testID?: string }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(value?.address ?? '');
  const [busy, setBusy] = useState<'find' | 'here' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function locate(how: 'find' | 'here'): Promise<boolean> {
    if (busy) return false;
    setBusy(how);
    setProblem(null);
    try {
      const pin = how === 'here' ? await currentPin() : await findAddress(address.trim());
      const text = address.trim() || t('engineBook.currentLocation');
      onChange({ address: text, lat: pin.lat, lng: pin.lng });
      setAddress(text);
      return true;
    } catch (e) {
      setProblem(t(`venue.problems.${e instanceof LocationError ? e.problem : 'failed'}`));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.group} testID={testID}>
      <TextField
        label={label}
        value={address}
        onChangeText={(v) => {
          setAddress(v);
          // A new address needs a new pin.
          if (value && v.trim() !== value.address) onChange(null);
        }}
        maxLength={300}
        placeholder={t('engineBook.addressPlaceholder')}
      />
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label={t('venue.find')} icon="pin" variant="outline" size="md" disabled={address.trim().length < 5 || busy === 'here'} loading={busy === 'find'} onPress={() => locate('find')} />
        </View>
        <View style={styles.flex}>
          <Button label={t('engineBook.useHere')} icon="locate" variant="outline" size="md" disabled={busy === 'find'} loading={busy === 'here'} onPress={() => locate('here')} />
        </View>
      </View>
      {value ? (
        <View style={styles.ok}>
          <Icon name="checkCircle" size={16} color={c.successText} />
          <AppText size="sm" color={c.successText}>
            {t('engineBook.placeFound')}
          </AppText>
        </View>
      ) : null}
      <FieldError>{problem}</FieldError>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
