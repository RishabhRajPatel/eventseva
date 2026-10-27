import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDistance, pinUrl, type LatLng, type OwnVendor } from '@eventseva/app-shared';
import { useCategories, useCities } from '../lib/queries';
import { c, space } from '../lib/theme';
import { currentPin, LocationError } from '../lib/location';
import { openLink } from '../lib/links';
import { Button, LinkButton } from './Button';
import { ChoiceChip } from './Chip';
import { Icon } from './Icon';
import { Field } from './Field';
import { Notice } from './Notice';
import { Txt } from './Txt';

export interface BusinessValues {
  businessName: string;
  categoryId: number | null;
  cityId: number | null;
  area: string;
  address: string;
  about: string;
  /** Where the vendor starts from (never shown to customers; they see distances). */
  pin: LatLng | null;
  /** How far they usually travel, km; null = not set. */
  radiusKm: number | null;
  /** GST number, needed before charging GST; empty = not registered. */
  gstin: string;
}

/** 15 characters: state code, PAN, entity number, Z, check character. */
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Travel ranges offered as chips. */
export const RADIUS_CHOICES = [5, 10, 20, 30, 50, 100] as const;

export const ABOUT_MIN = 20;

export function initialBusiness(v: OwnVendor | null | undefined): BusinessValues {
  return {
    businessName: v?.businessName ?? '',
    categoryId: v?.category.id ?? null,
    cityId: v?.city.id ?? null,
    area: v?.area ?? '',
    address: v?.address ?? '',
    about: v?.about ?? '',
    pin: v?.location ?? null,
    radiusKm: v?.serviceRadiusKm ?? null,
    gstin: v?.gstin ?? '',
  };
}

export type BusinessErrors = Partial<Record<keyof BusinessValues, string>>;

/** Same limits as the API, so most mistakes are caught before sending. */
export function validateBusiness(v: BusinessValues): Partial<Record<keyof BusinessValues, 'required' | 'short' | 'tooLong' | 'gstin'>> {
  const e: Partial<Record<keyof BusinessValues, 'required' | 'short' | 'tooLong' | 'gstin'>> = {};
  const name = v.businessName.trim();
  if (!name) e.businessName = 'required';
  else if (name.length < 2) e.businessName = 'short';
  if (!v.categoryId) e.categoryId = 'required';
  if (!v.cityId) e.cityId = 'required';
  if (!v.area.trim()) e.area = 'required';
  else if (v.area.trim().length < 2) e.area = 'short';
  if (v.address.trim() && v.address.trim().length < 5) e.address = 'short';
  if (v.about.length > 1500) e.about = 'tooLong';
  if (v.gstin.trim() && !GSTIN.test(v.gstin.trim().toUpperCase())) e.gstin = 'gstin';
  return e;
}

const SHOWN_CATEGORIES = 8;

export function BusinessForm({
  values,
  onChange,
  showErrors,
  categoryLocked,
}: {
  values: BusinessValues;
  onChange: (v: BusinessValues) => void;
  showErrors: boolean;
  categoryLocked?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const categories = useCategories();
  const cities = useCities();
  const [allCategories, setAllCategories] = useState(false);
  const errors = showErrors ? validateBusiness(values) : {};
  const err = (k: keyof BusinessValues) => (errors[k] ? t(`form.${errors[k]}`) : null);
  const set = <K extends keyof BusinessValues>(k: K, val: BusinessValues[K]) => onChange({ ...values, [k]: val });
  const lang = i18n.language === 'hi' ? 'hi' : 'en';
  const [locError, setLocError] = useState<string | null>(null);

  /** false = not done (error haptic on the button). */
  async function locate(): Promise<boolean> {
    setLocError(null);
    try {
      const pin = await currentPin();
      onChange({ ...values, pin });
      return true;
    } catch (e) {
      setLocError(t(`business.locationProblems.${e instanceof LocationError ? e.problem : 'failed'}`));
      return false;
    }
  }

  // Only one city for now: pick it for the vendor.
  useEffect(() => {
    if (!values.cityId && cities.data?.length === 1) onChange({ ...values, cityId: cities.data[0].id });
  }, [cities.data, values, onChange]);

  const cats = categories.data ?? [];
  const selectedIndex = cats.findIndex((x) => x.id === values.categoryId);
  const visible = allCategories || selectedIndex >= SHOWN_CATEGORIES ? cats : cats.slice(0, SHOWN_CATEGORIES);
  const cityName = cities.data?.find((x) => x.id === values.cityId)?.name;

  return (
    <View style={{ gap: space.xl }}>
      <Field
        testID="business-name"
        label={t('business.name')}
        value={values.businessName}
        onChangeText={(v) => set('businessName', v)}
        placeholder={t('business.namePlaceholder')}
        maxLength={80}
        error={err('businessName')}
      />

      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('business.category')}>
        <Txt variant="bold" size="sm">
          {t('business.category')}
        </Txt>
        {categoryLocked ? <Notice icon="lock">{t('business.categoryLocked')}</Notice> : null}
        <View style={styles.chips}>
          {visible.map((cat) => (
            <ChoiceChip
              key={cat.id}
              testID={`category-${cat.slug}`}
              label={cat.name}
              selected={cat.id === values.categoryId}
              disabled={categoryLocked}
              onPress={() => set('categoryId', cat.id)}
            />
          ))}
          {!allCategories && cats.length > visible.length ? <ChoiceChip label={t('business.moreCategories')} onPress={() => setAllCategories(true)} /> : null}
        </View>
        {err('categoryId') ? (
          <Txt size="sm" color={c.danger}>
            {err('categoryId')}
          </Txt>
        ) : null}
      </View>

      {(cities.data?.length ?? 0) > 1 ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="bold" size="sm">
            {t('business.city')}
          </Txt>
          <View style={styles.chips}>
            {cities.data!.map((city) => (
              <ChoiceChip key={city.id} label={city.name} selected={city.id === values.cityId} onPress={() => set('cityId', city.id)} />
            ))}
          </View>
        </View>
      ) : null}

      <Field
        testID="business-area"
        label={cityName ? t('business.areaIn', { city: cityName }) : t('business.area')}
        value={values.area}
        onChangeText={(v) => set('area', v)}
        placeholder={t('business.areaPlaceholder')}
        maxLength={80}
        error={err('area')}
      />
      <Field
        label={t('business.address')}
        value={values.address}
        onChangeText={(v) => set('address', v)}
        placeholder={t('business.addressPlaceholder')}
        maxLength={300}
        hint={t('business.addressHint')}
        error={err('address')}
      />
      <View style={{ gap: space.sm }} testID="base-location">
        <Txt variant="bold" size="sm">
          {t('business.base')}
        </Txt>
        <Txt size="sm" color={c.textMuted} style={{ lineHeight: 19 }}>
          {t('business.baseHint')}
        </Txt>
        {values.pin ? (
          <View style={styles.pinned} testID="base-pinned">
            <Icon name="check" size={18} color={c.onSuccess} />
            <Txt size="sm" color={c.onSuccess} style={{ flex: 1 }}>
              {t('business.basePinned')}
            </Txt>
            <LinkButton label={t('business.baseCheck')} onPress={() => void openLink(pinUrl(values.pin!))} />
          </View>
        ) : null}
        <Button
          testID="base-here"
          kind="secondary"
          icon="locate"
          label={values.pin ? t('business.baseUpdate') : t('business.baseHere')}
          loadingLabel={t('business.locating')}
          onPress={locate}
        />
        {locError ? (
          <Txt size="sm" color={c.danger} accessibilityRole="alert">
            {locError}
          </Txt>
        ) : null}
      </View>

      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('business.radius')}>
        <Txt variant="bold" size="sm">
          {t('business.radius')}
        </Txt>
        <View style={styles.chips}>
          {RADIUS_CHOICES.map((km) => (
            <ChoiceChip
              key={km}
              testID={`radius-${km}`}
              label={formatDistance(km, lang)}
              selected={values.radiusKm === km}
              onPress={() => set('radiusKm', km)}
            />
          ))}
          <ChoiceChip testID="radius-none" label={t('business.radiusAny')} selected={values.radiusKm === null} onPress={() => set('radiusKm', null)} />
        </View>
        <Txt size="xs" color={c.textMuted}>
          {t('business.radiusHint')}
        </Txt>
      </View>

      <Field
        testID="business-about"
        label={t('business.about')}
        value={values.about}
        onChangeText={(v) => set('about', v)}
        placeholder={t('business.aboutPlaceholder')}
        multiline
        maxLength={1500}
        hint={values.about.trim().length < ABOUT_MIN ? t('business.aboutHint', { min: ABOUT_MIN }) : t('business.aboutCount', { n: values.about.length })}
        error={err('about')}
      />

      <Field
        testID="business-gstin"
        label={`${t('business.gstin')} ${t('form.optional')}`}
        value={values.gstin}
        onChangeText={(v) => set('gstin', v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))}
        placeholder="09ABCDE1234F1Z5"
        autoCapitalize="characters"
        maxLength={15}
        hint={t('business.gstinHint')}
        error={err('gstin')}
      />
    </View>
  );
}

/** Only changed fields are sent; empty optional fields are left out (the API cannot clear them). */
export function businessPayload(v: BusinessValues, initial?: BusinessValues) {
  const out: Record<string, string | number | null> = {};
  const put = (k: keyof BusinessValues, val: string | number | null) => {
    if (val === null || val === '') return;
    if (initial && initial[k] === val) return;
    out[k] = val;
  };
  put('businessName', v.businessName.trim());
  put('categoryId', v.categoryId);
  put('cityId', v.cityId);
  put('area', v.area.trim());
  put('address', v.address.trim());
  put('about', v.about.trim());
  if (v.pin && (!initial?.pin || initial.pin.lat !== v.pin.lat || initial.pin.lng !== v.pin.lng)) {
    out.lat = v.pin.lat;
    out.lng = v.pin.lng;
  }
  // null is sent on purpose: it clears the range.
  if (!initial ? v.radiusKm !== null : initial.radiusKm !== v.radiusKm) out.serviceRadiusKm = v.radiusKm;
  // Clearing the GST number is allowed (null); unchanged it is left out.
  const gstin = v.gstin.trim().toUpperCase();
  if (!initial ? gstin !== '' : initial.gstin !== gstin) out.gstin = gstin || null;
  return out;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.mintLight, borderRadius: 12, padding: space.md },
});
