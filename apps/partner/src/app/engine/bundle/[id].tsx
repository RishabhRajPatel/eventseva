import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EngineService, ServiceBundle } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { confirm } from '../../../lib/confirm';
import { errorText } from '../../../lib/errors';
import { invalidateEngine, useBundles, useEngineServices } from '../../../lib/engine';
import { toast } from '../../../lib/toast';
import { c, space } from '../../../lib/theme';
import { useForm } from '../../../hooks/useForm';
import { Button } from '../../../components/Button';
import { Card, Row } from '../../../components/Card';
import { ChoiceChip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Notice } from '../../../components/Notice';
import { Screen } from '../../../components/Screen';
import { QueryView } from '../../../components/States';
import { Txt } from '../../../components/Txt';

type Pick = 'off' | 'optional' | 'mandatory';
const FIELDS = ['name', 'items', 'discount'] as const;

/** Services booked together, e.g. "Wedding: DJ + lights + baraat", with an optional discount. */
export default function BundleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bundles = useBundles();
  const services = useEngineServices();
  return (
    <QueryView query={services}>
      {(list) =>
        id === 'new' ? (
          <BundleForm bundle={null} services={list} />
        ) : (
          <QueryView query={bundles}>{(all) => <BundleForm bundle={all.find((b) => b.id === id) ?? null} services={list} missing={!all.some((b) => b.id === id)} />}</QueryView>
        )
      }
    </QueryView>
  );
}

function BundleForm({ bundle, services, missing }: { bundle: ServiceBundle | null; services: EngineService[]; missing?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm(FIELDS);
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [discount, setDiscount] = useState(bundle?.discountPercent ? String(bundle.discountPercent) : '');
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries((bundle?.items ?? []).map((i) => [i.serviceId, i.mandatory ? 'mandatory' : 'optional'] as const)),
  );

  const chosen = services.filter((s) => (picks[s.id] ?? 'off') !== 'off');
  const pct = discount ? Number(discount) : 0;
  const errors = {
    name: name.trim().length < 2 ? t(name.trim() ? 'form.short' : 'engine.nameRequired') : null,
    items: chosen.length < 2 ? t('engine.bundleTwo') : !chosen.some((s) => picks[s.id] === 'mandatory') ? t('engine.bundleOneMandatory') : null,
    discount: pct > 50 ? t('engine.discountMax') : null,
  };

  const save = useMutation({
    mutationFn: (body: object) => (bundle ? api.patch(`/v1/partner/bundles/${bundle.id}`, body) : api.post('/v1/partner/bundles', body)),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t(bundle ? 'engine.bundleSaved' : 'engine.bundleAdded'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/partner/bundles/${bundle!.id}`),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t('engine.bundleRemoved'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  if (missing) return <Screen back title={t('engine.editBundle')}><Notice tone="warning">{t('engine.notFound')}</Notice></Screen>;

  function submit() {
    if (save.isPending || !form.check(errors)) return;
    save.mutate({
      name: name.trim(),
      description: description.trim() || null,
      discountPercent: pct,
      items: chosen.map((s) => ({ serviceId: s.id, mandatory: picks[s.id] === 'mandatory' })),
    });
  }

  async function confirmRemove() {
    const ok = await confirm({ title: t('catalog.deleteTitleNamed', { name: bundle!.name }), body: t('engine.deleteBundleBody'), confirmLabel: t('common.delete'), cancelLabel: t('common.keep'), destructive: true });
    if (ok) remove.mutate();
  }

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={bundle ? t('engine.editBundle') : t('engine.newBundle')}
      footer={
        <>
          <Button testID="save-bundle" size="lg" label={bundle ? t('common.saveChanges') : t('common.add')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {bundle ? <Button testID="delete-bundle" kind="dangerOutline" icon="trash" label={t('common.delete')} loading={remove.isPending} onPress={() => void confirmRemove()} /> : null}
        </>
      }
    >
      <View {...form.at('name')}>
        <Field ref={form.ref('name')} testID="bundle-name" label={t('engine.bundleName')} value={name} onChangeText={setName} onBlur={form.blur('name')} maxLength={80}
          placeholder={t('engine.bundleNamePlaceholder')} error={form.show('name') ? errors.name : null} />
      </View>
      <Field testID="bundle-description" label={`${t('engine.description')} ${t('form.optional')}`} value={description} onChangeText={setDescription} multiline maxLength={500} />
      <View {...form.at('items')}>
        <Card>
          <Txt variant="bold" size="sm">{t('engine.bundleServices')}</Txt>
          {services.map((s, i) => (
            <Row key={s.id} first={i === 0} style={{ flexDirection: 'column', alignItems: 'stretch', gap: space.sm }}>
              <Txt size="md">{s.title}</Txt>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={s.title}>
                {(['off', 'optional', 'mandatory'] as const).map((p) => (
                  <ChoiceChip key={p} testID={`bundle-${s.id}-${p}`} label={t(`engine.bundlePick.${p}`)} selected={(picks[s.id] ?? 'off') === p} onPress={() => setPicks({ ...picks, [s.id]: p })} />
                ))}
              </View>
            </Row>
          ))}
        </Card>
        {form.show('items') && errors.items ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{errors.items}</Txt> : null}
      </View>
      <View {...form.at('discount')}>
        <Field testID="bundle-discount" label={`${t('engine.bundleDiscount')} ${t('form.optional')}`} value={discount} onChangeText={(v) => setDiscount(v.replace(/\D/g, '').slice(0, 2))}
          keyboardType="number-pad" maxLength={2} placeholder="0" hint={t('engine.bundleDiscountHint')} error={form.show('discount') ? errors.discount : null} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
