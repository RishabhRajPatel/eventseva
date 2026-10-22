import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PricingUnit, Service } from '@eventseva/app-shared';
import { defaultServiceUnit, SERVICE_UNITS as UNITS } from '../../lib/catalog';
import { checkPrice, paiseToRupeesInput } from '../../lib/money';
import { useCategories, useVendor } from '../../lib/queries';
import { unitLabel } from '../../lib/labels';
import { c, space } from '../../lib/theme';
import { useCatalogMutations } from '../../hooks/useCatalogMutations';
import { Button } from '../../components/Button';
import { ChoiceChip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { PriceInput } from '../../components/PriceInput';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Add or edit one service: title, price in rupees, unit and guest range. */
export default function ServiceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vendor = useVendor();
  return (
    <QueryView query={vendor}>
      {(v) => <ServiceForm service={id === 'new' ? null : v?.services.find((s) => s.id === id) ?? null} isNew={id === 'new'} categoryId={v?.category.id} />}
    </QueryView>
  );
}

function ServiceForm({ service, isNew, categoryId }: { service: Service | null; isNew: boolean; categoryId?: number }) {
  const { t } = useTranslation();
  const categories = useCategories();
  const { save, remove, confirmRemove } = useCatalogMutations('services', service?.id ?? null);
  const [title, setTitle] = useState(service?.title ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState(service ? paiseToRupeesInput(service.pricePaise) : '');
  const [unit, setUnit] = useState<PricingUnit | null>(service?.unit ?? null);
  const [minGuests, setMinGuests] = useState(service?.minGuests ? String(service.minGuests) : '');
  const [maxGuests, setMaxGuests] = useState(service?.maxGuests ? String(service.maxGuests) : '');
  const [tried, setTried] = useState(false);

  // New services start with the unit usual for the vendor's category (per plate for cooks …).
  const defaultUnit = categories.data?.find((x) => x.id === categoryId)?.defaultUnit;
  useEffect(() => {
    if (!unit && defaultUnit) setUnit(defaultServiceUnit(defaultUnit));
  }, [unit, defaultUnit]);

  const priceCheck = checkPrice(price);
  const min = minGuests ? Number(minGuests) : undefined;
  const max = maxGuests ? Number(maxGuests) : undefined;
  const titleError = title.trim().length < 2 ? t('form.short') : null;
  const guestError = min !== undefined && max !== undefined && min > max ? t('service.guestRangeError') : null;

  function submit() {
    setTried(true);
    if (titleError || guestError || !priceCheck.ok) return;
    save.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      pricePaise: priceCheck.paise,
      unit: unit ?? 'per_event',
      minGuests: min,
      maxGuests: max,
    });
  }

  if (!isNew && !service) {
    return (
      <Screen back title={t('service.editTitle')}>
        <Txt>{t('catalog.notFound')}</Txt>
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={isNew ? t('service.newTitle') : t('service.editTitle')}
      footer={
        <>
          <Button testID="save-service" size="lg" label={t('common.save')} loading={save.isPending} onPress={submit} />
          {!isNew ? <Button kind="danger" label={t('common.delete')} loading={remove.isPending} onPress={confirmRemove} /> : null}
        </>
      }
    >
      <Field testID="service-title" label={t('service.title')} value={title} onChangeText={setTitle} maxLength={80} placeholder={t('service.titlePlaceholder')} error={tried ? titleError : null} />
      <PriceInput testID="service-price" label={t('service.price')} value={price} onChange={setPrice} showError={tried} />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('service.unit')}>
        <Txt variant="bold" size="sm">
          {t('service.unit')}
        </Txt>
        <View style={styles.chips}>
          {UNITS.map((u) => (
            <ChoiceChip key={u} testID={`unit-${u}`} label={unitLabel(t, u)} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>
      </View>
      <Field label={t('service.description')} value={description} onChangeText={setDescription} multiline maxLength={500} placeholder={t('service.descriptionPlaceholder')} />
      <View style={styles.guests}>
        <View style={{ flex: 1 }}>
          <Field label={t('service.minGuests')} value={minGuests} onChangeText={(v) => setMinGuests(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('service.maxGuests')} value={maxGuests} onChangeText={(v) => setMaxGuests(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} />
        </View>
      </View>
      {guestError && tried ? <Txt color={c.danger}>{guestError}</Txt> : null}
      <Txt size="xs">{t('catalog.note')}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  guests: { flexDirection: 'row', gap: space.md },
});
