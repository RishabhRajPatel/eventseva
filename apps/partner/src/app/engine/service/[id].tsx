import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EngineService, ServiceSetup, VendorResource } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { confirm } from '../../../lib/confirm';
import { errorCode, errorText } from '../../../lib/errors';
import {
  fieldErrors,
  GST_RATES,
  initialValues,
  invalidateEngine,
  isMoneyKey,
  priceExtras,
  priceForm,
  ruleForm,
  ruleKeys,
  toPricing,
  toRules,
  toValues,
  useEngineServices,
  useResources,
  useServiceSetup,
  type FieldValues,
  type PriceForm,
  type PriceKey,
  type RuleForm,
  type RuleKey,
} from '../../../lib/engine';
import { useVendor } from '../../../lib/queries';
import { toast } from '../../../lib/toast';
import { c, space } from '../../../lib/theme';
import { useForm } from '../../../hooks/useForm';
import { Button, LinkButton } from '../../../components/Button';
import { Card, CardHeader } from '../../../components/Card';
import { ChoiceChip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { FieldInput } from '../../../components/FieldInput';
import { Notice } from '../../../components/Notice';
import { PriceInput } from '../../../components/PriceInput';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { QueryView } from '../../../components/States';
import { Txt } from '../../../components/Txt';

/** Add or edit a service booked by time or quantity: price model and rate, rules, details. */
export default function EngineServiceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const setup = useServiceSetup();
  const services = useEngineServices();
  const isNew = id === 'new';
  return (
    <QueryView query={setup}>
      {(s) =>
        isNew ? (
          <ServiceForm setup={s} service={null} />
        ) : (
          <QueryView query={services}>{(list) => <ServiceForm setup={s} service={list.find((x) => x.id === id) ?? null} missing={!list.some((x) => x.id === id)} />}</QueryView>
        )
      }
    </QueryView>
  );
}

const FIELDS = ['title', 'resource', 'price', 'attributes', 'rules'] as const;
/** Typed with decimals: rupees and hours. */
const DECIMAL_RULES: RuleKey[] = ['deposit', 'minHours', 'maxHours', 'setupHours', 'dismantleHours', 'bufferHours'];

function ServiceForm({ setup, service, missing }: { setup: ServiceSetup; service: EngineService | null; missing?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm(FIELDS);
  const vendor = useVendor();
  const resources = useResources();
  const type = setup.bookingType;
  const models = setup.pricingModels.length ? setup.pricingModels : (['fixed'] as const);

  const [title, setTitle] = useState(service?.title ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState<PriceForm>(priceForm(service?.pricing, [...models]));
  const [rules, setRules] = useState<RuleForm>(ruleForm(service?.rules ?? setup.defaultRules));
  const [attrs, setAttrs] = useState<FieldValues>(initialValues(setup.attributes, service?.attributes));
  const [resourceId, setResourceId] = useState<string | null>(service?.resourceId ?? null);

  const choosable = (resources.data ?? []).filter((r) => r.kind === setup.resourceKind && r.status !== 'inactive');
  const needsResource = type === 'transport';
  const pricing = toPricing(type, price);
  const ruleCheck = toRules(type, rules, setup.defaultRules.leadTimeHours);
  const attrErrors = fieldErrors(setup.attributes, attrs);
  const hasGstin = !!vendor.data?.gstin;
  const errors = {
    title: title.trim().length < 2 ? t(title.trim() ? 'form.short' : 'engine.titleRequired') : null,
    resource: needsResource && !resourceId ? t('engine.chooseVehicle') : null,
    price: pricing.ok ? null : pricing.field,
    rules: ruleCheck.ok
      ? null
      : t(`engine.ruleError.${ruleCheck.reason}`, {
          n: setup.defaultRules.leadTimeHours ?? 0,
        }),
    attributes: Object.keys(attrErrors).length ? 'attributes' : null,
  };

  const save = useMutation({
    mutationFn: (body: object) =>
      service ? api.patch<EngineService>(`/v1/partner/engine-services/${service.id}`, body) : api.post<EngineService>('/v1/partner/engine-services', body),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t(service ? 'engine.serviceSaved' : 'engine.serviceAdded'));
      router.back();
    },
    onError: (e) => toast.error(errorCode(e) === 'GSTIN_REQUIRED' ? t('engine.gstinFirst') : errorText(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/partner/engine-services/${service!.id}`),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t('engine.serviceRemoved'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  if (missing)
    return (
      <Screen back title={t('engine.editService')}>
        <Notice tone="warning">{t('engine.notFound')}</Notice>
      </Screen>
    );

  function submit() {
    if (save.isPending || !form.check(errors) || !pricing.ok || !ruleCheck.ok) return;
    save.mutate({
      title: title.trim(),
      description: description.trim() || null,
      pricing: pricing.pricing,
      rules: ruleCheck.rules,
      attributes: toValues(setup.attributes, attrs),
      ...(setup.resourceKind && setup.resourceKind !== 'crew' ? { resourceId } : {}),
    });
  }

  async function confirmRemove() {
    const ok = await confirm({
      title: t('catalog.deleteTitleNamed', { name: service!.title }),
      body: t('engine.deleteServiceBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.keep'),
      destructive: true,
    });
    if (ok) remove.mutate();
  }

  const setExtra = (k: PriceKey) => (v: string) =>
    setPrice({
      ...price,
      extras: {
        ...price.extras,
        [k]: isMoneyKey(k) ? v.replace(/[^\d.]/g, '') : v.replace(/\D/g, ''),
      },
    });
  const setRule = (k: RuleKey) => (v: string) =>
    setRules({
      ...rules,
      [k]: v.replace(DECIMAL_RULES.includes(k) ? /[^\d.]/g : /\D/g, ''),
    });

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={service ? t('engine.editService') : t('engine.newService')}
      footer={
        <>
          <Button
            testID="save-service"
            size="lg"
            label={service ? t('common.saveChanges') : t('engine.addService')}
            loadingLabel={t('common.saving')}
            loading={save.isPending}
            onPress={submit}
          />
          {service ? (
            <Button testID="delete-service" kind="dangerOutline" icon="trash" label={t('engine.deleteService')} loading={remove.isPending} onPress={() => void confirmRemove()} />
          ) : null}
        </>
      }
    >
      <View {...form.at('title')}>
        <Field
          ref={form.ref('title')}
          testID="service-title"
          label={t('engine.serviceTitle')}
          value={title}
          onChangeText={setTitle}
          onBlur={form.blur('title')}
          maxLength={80}
          placeholder={t(`engine.titlePlaceholder.${type}`)}
          error={form.show('title') ? errors.title : null}
        />
      </View>
      <Field testID="service-description" label={`${t('engine.description')} ${t('form.optional')}`} value={description} onChangeText={setDescription} multiline maxLength={500} />

      {setup.resourceKind && setup.resourceKind !== 'crew' ? (
        <View style={styles.group} {...form.at('resource')} accessibilityRole="radiogroup" accessibilityLabel={t(`engine.which.${setup.resourceKind}`)}>
          <Txt variant="bold" size="sm">
            {t(`engine.which.${setup.resourceKind}`)}
          </Txt>
          <View style={styles.chips}>
            {choosable.map((r: VendorResource) => (
              <ChoiceChip
                key={r.id}
                testID={`pick-resource-${r.id}`}
                label={r.name}
                selected={resourceId === r.id}
                onPress={() => setResourceId(resourceId === r.id && !needsResource ? null : r.id)}
              />
            ))}
          </View>
          {!choosable.length ? (
            <LinkButton
              testID="add-first-resource"
              label={t(`engine.addResource.${setup.resourceKind}`)}
              onPress={() =>
                router.push({
                  pathname: '/engine/resource/[id]',
                  params: { id: 'new', kind: setup.resourceKind! },
                })
              }
            />
          ) : null}
          {form.show('resource') && errors.resource ? (
            <Txt size="sm" color={c.danger} accessibilityRole="alert">
              {errors.resource}
            </Txt>
          ) : null}
        </View>
      ) : null}

      <View {...form.at('price')}>
        <Card style={{ gap: space.md }}>
          <CardHeader title={t('engine.price')} />
          {models.length > 1 ? (
            <Segmented
              options={models.map((m) => ({
                key: m,
                label: t(`engine.model.${m}`),
              }))}
              value={price.model}
              onChange={(model) => setPrice({ ...price, model })}
            />
          ) : null}
          {price.model === 'quote' ? (
            <Notice tone="info">{t('engine.quoteNote')}</Notice>
          ) : (
            <PriceInput
              testID="service-rate"
              label={t(`engine.rateLabel.${price.model}`)}
              value={price.rate}
              onChange={(rate) => setPrice({ ...price, rate })}
              showError={form.show('price') && errors.price === 'rate'}
            />
          )}
          {priceExtras(type, price.model).map((k) => (
            <Field
              key={k}
              testID={`price-${k}`}
              label={`${t(`engine.priceField.${k}`)} ${t('form.optional')}`}
              prefix={isMoneyKey(k) ? '₹' : undefined}
              value={price.extras[k] ?? ''}
              onChangeText={setExtra(k)}
              keyboardType={isMoneyKey(k) ? 'decimal-pad' : 'number-pad'}
              maxLength={9}
              error={form.show('price') && errors.price === k ? t('engine.numberInvalid') : null}
            />
          ))}
          <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('engine.gst')}>
            <Txt variant="bold" size="sm">
              {t('engine.gst')}
            </Txt>
            <View style={styles.chips}>
              {GST_RATES.map((r) => (
                <ChoiceChip
                  key={r}
                  testID={`gst-${r}`}
                  label={r ? `${r}%` : t('engine.noGst')}
                  selected={price.taxPercent === r}
                  disabled={r > 0 && !hasGstin}
                  disabledHint={t('engine.gstinFirst')}
                  onPress={() => setPrice({ ...price, taxPercent: r })}
                />
              ))}
            </View>
            {!hasGstin ? <LinkButton testID="add-gstin" label={t('engine.addGstin')} onPress={() => router.push('/business')} /> : null}
          </View>
        </Card>
      </View>

      {setup.attributes.length ? (
        <View {...form.at('attributes')}>
          <Card style={{ gap: space.md }}>
            <CardHeader title={t('engine.details')} />
            {setup.attributes.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={attrs[f.key]}
                onChange={(v) => setAttrs({ ...attrs, [f.key]: v })}
                error={form.show('attributes') ? attrErrors[f.key] : null}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View {...form.at('rules')}>
        <Card style={{ gap: space.md }}>
          <CardHeader title={t('engine.rules')} />
          <Txt size="xs" color={c.textMuted}>
            {t('engine.rulesHint')}
          </Txt>
          {ruleKeys(type).map((k) => (
            <Field
              key={k}
              testID={`rule-${k}`}
              label={`${t(`engine.rule.${k}`)} ${t('form.optional')}`}
              prefix={k === 'deposit' ? '₹' : undefined}
              value={rules[k] ?? ''}
              onChangeText={setRule(k)}
              keyboardType="decimal-pad"
              maxLength={7}
            />
          ))}
          {form.show('rules') && errors.rules ? (
            <Txt size="sm" color={c.danger} accessibilityRole="alert">
              {errors.rules}
            </Txt>
          ) : null}
          <Txt variant="bold" size="sm">
            {t('engine.approval')}
          </Txt>
          <Segmented
            options={[
              { key: 'vendor', label: t('engine.approvalVendor') },
              { key: 'auto', label: t('engine.approvalAuto') },
            ]}
            value={rules.approval}
            onChange={(approval) => setRules({ ...rules, approval })}
          />
          <Txt size="xs" color={c.textMuted}>
            {t(rules.approval === 'auto' ? 'engine.approvalAutoNote' : 'engine.approvalVendorNote')}
          </Txt>
          <Field
            testID="rule-instructions"
            label={`${t('engine.instructions')} ${t('form.optional')}`}
            value={rules.instructions}
            onChangeText={(instructions) => setRules({ ...rules, instructions })}
            multiline
            maxLength={1000}
            placeholder={t('engine.instructionsPlaceholder')}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
