import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EngineService, ServiceAddon } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { confirm } from '../../../lib/confirm';
import { errorText } from '../../../lib/errors';
import { invalidateEngine, useAddons, useEngineServices } from '../../../lib/engine';
import { paiseToRupeesInput, rupeesInputToPaise } from '../../../lib/money';
import { toast } from '../../../lib/toast';
import { c, space } from '../../../lib/theme';
import { useForm } from '../../../hooks/useForm';
import { Button } from '../../../components/Button';
import { ChoiceChip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Notice } from '../../../components/Notice';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { QueryView } from '../../../components/States';
import { Txt } from '../../../components/Txt';

export const ADDON_KINDS = ['extra', 'decoration', 'package', 'equipment', 'trial'] as const;
const FIELDS = ['name', 'price'] as const;

/** One line per inclusion; empty lines dropped. */
export const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

/** An extra the customer can add to a booking (decoration, extra hour, trial …), for all services or one. */
export default function AddonEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const addons = useAddons();
  const services = useEngineServices();
  return (
    <QueryView query={services}>
      {(list) =>
        id === 'new' ? (
          <AddonForm addon={null} services={list} />
        ) : (
          <QueryView query={addons}>{(all) => <AddonForm addon={all.find((a) => a.id === id) ?? null} services={list} missing={!all.some((a) => a.id === id)} />}</QueryView>
        )
      }
    </QueryView>
  );
}

function AddonForm({ addon, services, missing }: { addon: ServiceAddon | null; services: EngineService[]; missing?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm(FIELDS);
  const [name, setName] = useState(addon?.name ?? '');
  const [kind, setKind] = useState<string>(addon?.kind ?? 'extra');
  const [price, setPrice] = useState(addon ? paiseToRupeesInput(addon.pricePaise) : '');
  const [serviceId, setServiceId] = useState<string | null>(addon?.serviceId ?? null);
  const [includes, setIncludes] = useState((addon?.inclusions ?? []).join('\n'));
  const [excludes, setExcludes] = useState((addon?.exclusions ?? []).join('\n'));
  const [setupMin, setSetupMin] = useState(addon?.setupMinutes ? String(addon.setupMinutes) : '');
  const [approval, setApproval] = useState<'yes' | 'no'>(addon?.requiresApproval ? 'yes' : 'no');

  const paise = price.trim() ? rupeesInputToPaise(price) : null;
  const errors = {
    name: name.trim().length < 2 ? t(name.trim() ? 'form.short' : 'engine.nameRequired') : null,
    price: paise === null ? t('engine.priceRequired') : null,
  };

  const save = useMutation({
    mutationFn: (body: object) => (addon ? api.patch(`/v1/partner/addons/${addon.id}`, body) : api.post('/v1/partner/addons', body)),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t(addon ? 'engine.addonSaved' : 'engine.addonAdded'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/partner/addons/${addon!.id}`),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t('engine.addonRemoved'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  if (missing) return <Screen back title={t('engine.editAddon')}><Notice tone="warning">{t('engine.notFound')}</Notice></Screen>;

  function submit() {
    if (save.isPending || !form.check(errors) || paise === null) return;
    save.mutate({
      name: name.trim(),
      kind,
      pricePaise: paise,
      serviceId,
      inclusions: lines(includes),
      exclusions: lines(excludes),
      setupMinutes: setupMin ? Number(setupMin) : 0,
      requiresApproval: approval === 'yes',
    });
  }

  async function confirmRemove() {
    const ok = await confirm({ title: t('catalog.deleteTitleNamed', { name: addon!.name }), body: t('engine.deleteAddonBody'), confirmLabel: t('common.delete'), cancelLabel: t('common.keep'), destructive: true });
    if (ok) remove.mutate();
  }

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={addon ? t('engine.editAddon') : t('engine.newAddon')}
      footer={
        <>
          <Button testID="save-addon" size="lg" label={addon ? t('common.saveChanges') : t('common.add')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {addon ? <Button testID="delete-addon" kind="dangerOutline" icon="trash" label={t('common.delete')} loading={remove.isPending} onPress={() => void confirmRemove()} /> : null}
        </>
      }
    >
      <View {...form.at('name')}>
        <Field ref={form.ref('name')} testID="addon-name" label={t('engine.addonName')} value={name} onChangeText={setName} onBlur={form.blur('name')} maxLength={80}
          placeholder={t('engine.addonNamePlaceholder')} error={form.show('name') ? errors.name : null} />
      </View>
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('engine.addonKind')}>
        <Txt variant="bold" size="sm">{t('engine.addonKind')}</Txt>
        <View style={styles.chips}>
          {ADDON_KINDS.map((k) => (
            <ChoiceChip key={k} testID={`addon-kind-${k}`} label={t(`engine.addonKinds.${k}`)} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
      </View>
      <View {...form.at('price')}>
        <Field ref={form.ref('price')} testID="addon-price" label={t('engine.addonPrice')} prefix="₹" value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))}
          onBlur={form.blur('price')} keyboardType="decimal-pad" maxLength={9} placeholder="0" hint={t('engine.addonPriceHint')} error={form.show('price') ? errors.price : null} />
      </View>
      {services.length ? (
        <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('engine.addonFor')}>
          <Txt variant="bold" size="sm">{t('engine.addonFor')}</Txt>
          <View style={styles.chips}>
            <ChoiceChip testID="addon-for-all" label={t('engine.allServices')} selected={!serviceId} onPress={() => setServiceId(null)} />
            {services.map((s) => (
              <ChoiceChip key={s.id} testID={`addon-for-${s.id}`} label={s.title} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
            ))}
          </View>
        </View>
      ) : null}
      <Field testID="addon-includes" label={`${t('engine.includes')} ${t('form.optional')}`} hint={t('engine.oneLineEach')} value={includes} onChangeText={setIncludes} multiline maxLength={1000} />
      <Field testID="addon-excludes" label={`${t('engine.excludes')} ${t('form.optional')}`} hint={t('engine.oneLineEach')} value={excludes} onChangeText={setExcludes} multiline maxLength={1000} />
      <Field testID="addon-setup" label={`${t('engine.setupMinutes')} ${t('form.optional')}`} value={setupMin} onChangeText={(v) => setSetupMin(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} />
      <View style={styles.group}>
        <Txt variant="bold" size="sm">{t('engine.addonApproval')}</Txt>
        <Segmented options={[{ key: 'no', label: t('engine.addonApprovalNo') }, { key: 'yes', label: t('engine.addonApprovalYes') }]} value={approval} onChange={setApproval} />
        <Txt size="xs" color={c.textMuted}>{t(approval === 'yes' ? 'engine.addonApprovalYesNote' : 'engine.addonApprovalNoNote')}</Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
