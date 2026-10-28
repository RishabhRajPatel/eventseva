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
import { useForm } from '../../hooks/useForm';
import { Button } from '../../components/Button';
import { CashToggle } from '../../components/CashToggle';
import { ChoiceChip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { PriceInput } from '../../components/PriceInput';
import { Screen } from '../../components/Screen';
import { EmptyInline, QueryView } from '../../components/States';
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

const FIELDS = ['title', 'price', 'guests'] as const;

function ServiceForm({ service, isNew, categoryId }: { service: Service | null; isNew: boolean; categoryId?: number }) {
  const { t } = useTranslation();
  const categories = useCategories();
  const { save, remove, confirmRemove } = useCatalogMutations('services', service?.id ?? null);
  const form = useForm(FIELDS);
  const [title, setTitle] = useState(service?.title ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState(service ? paiseToRupeesInput(service.pricePaise) : '');
  const [unit, setUnit] = useState<PricingUnit | null>(service?.unit ?? null);
  const [minGuests, setMinGuests] = useState(service?.minGuests ? String(service.minGuests) : '');
  const [maxGuests, setMaxGuests] = useState(service?.maxGuests ? String(service.maxGuests) : '');
  const [cashAllowed, setCashAllowed] = useState(service?.cashAllowed ?? false);

  // New services start with the unit usual for the vendor's category (per plate for cooks …).
  const defaultUnit = categories.data?.find((x) => x.id === categoryId)?.defaultUnit;
  useEffect(() => {
    if (!unit && defaultUnit) setUnit(defaultServiceUnit(defaultUnit));
  }, [unit, defaultUnit]);

  const priceCheck = checkPrice(price);
  const min = minGuests ? Number(minGuests) : undefined;
  const max = maxGuests ? Number(maxGuests) : undefined;
  const errors = {
    title: title.trim().length < 2 ? t(title.trim() ? 'form.short' : 'service.titleRequired') : null,
    price: priceCheck.ok ? null : 'price',
    guests: min !== undefined && max !== undefined && min > max ? t('service.guestRangeError') : null,
  };

  function submit() {
    if (save.isPending || !form.check(errors) || !priceCheck.ok) return;
    save.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      pricePaise: priceCheck.paise,
      unit: unit ?? 'per_event',
      minGuests: min,
      maxGuests: max,
      cashAllowed,
    });
  }

  if (!isNew && !service) {
    return (
      <Screen back title={t('service.editTitle')}>
        <EmptyInline icon="search" text={t('catalog.notFound')} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={isNew ? t('service.newTitle') : t('service.editTitle')}
      footer={
        <>
          <Button testID="save-service" size="lg" label={isNew ? t('service.add') : t('common.saveChanges')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {!isNew ? <Button testID="delete-service" kind="dangerOutline" icon="trash" label={t('service.delete')} loading={remove.isPending} disabled={save.isPending} onPress={() => confirmRemove(service?.title ?? '')} /> : null}
        </>
      }
    >
      <View {...form.at('title')}>
        <Field
          ref={form.ref('title')}
          testID="service-title"
          label={t('service.title')}
          value={title}
          onChangeText={setTitle}
          onBlur={form.blur('title')}
          maxLength={80}
          placeholder={t('service.titlePlaceholder')}
          error={form.show('title') ? errors.title : null}
        />
      </View>
      <View {...form.at('price')}>
        <PriceInput ref={form.ref('price')} testID="service-price" label={t('service.price')} value={price} onChange={setPrice} onBlur={form.blur('price')} showError={form.show('price')} />
      </View>
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
      <View style={{ gap: space.sm }} {...form.at('guests')}>
        <View style={styles.guests}>
          <View style={{ flex: 1 }}>
            <Field
              ref={form.ref('guests')}
              testID="min-guests"
              label={t('service.minGuests')}
              value={minGuests}
              onChangeText={(v) => setMinGuests(v.replace(/\D/g, ''))}
              onBlur={form.blur('guests')}
              keyboardType="number-pad"
              maxLength={6}
              error={form.show('guests') && errors.guests ? ' ' : null}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              testID="max-guests"
              label={t('service.maxGuests')}
              value={maxGuests}
              onChangeText={(v) => setMaxGuests(v.replace(/\D/g, ''))}
              onBlur={form.blur('guests')}
              keyboardType="number-pad"
              maxLength={6}
              error={form.show('guests') && errors.guests ? ' ' : null}
            />
          </View>
        </View>
        {form.show('guests') && errors.guests ? (
          <Txt size="sm" color={c.danger} accessibilityRole="alert">
            {errors.guests}
          </Txt>
        ) : null}
      </View>
      <CashToggle value={cashAllowed} onChange={setCashAllowed} />
      <Txt size="xs" color={c.textMuted}>
        {t('catalog.note')}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  guests: { flexDirection: 'row', gap: space.md },
});
