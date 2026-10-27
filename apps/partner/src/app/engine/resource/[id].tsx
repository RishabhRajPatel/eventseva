import { useRef, useState } from 'react';
import { View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ResourceKind, ServiceSetup, VendorResource } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { confirm } from '../../../lib/confirm';
import { errorCode, errorText } from '../../../lib/errors';
import { DOC_TYPES, engineKeys, fieldErrors, initialValues, invalidateEngine, toValues, useResources, useServiceSetup, type FieldValues } from '../../../lib/engine';
import { toast } from '../../../lib/toast';
import { uploadResourceDocument, type PickedFile } from '../../../lib/upload';
import { c, space } from '../../../lib/theme';
import { toPicked } from '../../../hooks/usePhotoUpload';
import { useForm } from '../../../hooks/useForm';
import { ActionSheet } from '../../../components/ActionSheet';
import { Button } from '../../../components/Button';
import { Card, CardHeader, Row } from '../../../components/Card';
import { Pill, type Tone } from '../../../components/Chip';
import { pickPdf } from '../../../components/DocumentsCard';
import { Field } from '../../../components/Field';
import { FieldInput } from '../../../components/FieldInput';
import { Notice } from '../../../components/Notice';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { QueryView } from '../../../components/States';
import { Txt } from '../../../components/Txt';

const KINDS: ResourceKind[] = ['vehicle', 'driver', 'staff', 'artist', 'venue', 'equipment'];

/** A vehicle, driver, staff member, artist or hall: details, and the papers EventSeva checks. */
export default function ResourceEditor() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const setup = useServiceSetup();
  const resources = useResources();
  const isNew = id === 'new';
  const newKind = KINDS.find((k) => k === kind) ?? 'staff';
  return (
    <QueryView query={setup}>
      {(s) =>
        isNew ? (
          <ResourceForm setup={s} resource={null} kind={newKind} />
        ) : (
          <QueryView query={resources}>
            {(list) => {
              const r = list.find((x) => x.id === id);
              return r ? <ResourceForm setup={s} resource={r} kind={r.kind} /> : <NotFound />;
            }}
          </QueryView>
        )
      }
    </QueryView>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Screen back title={t('engine.editResource')}>
      <Notice tone="warning">{t('engine.notFound')}</Notice>
    </Screen>
  );
}

const FIELDS = ['name', 'attributes'] as const;

function ResourceForm({ setup, resource, kind }: { setup: ServiceSetup; resource: VendorResource | null; kind: ResourceKind }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm(FIELDS);
  const fields = setup.resourceFields[kind] ?? [];
  const [name, setName] = useState(resource?.name ?? '');
  const [values, setValues] = useState<FieldValues>(initialValues(fields, resource?.attributes));
  const [status, setStatus] = useState<'active' | 'maintenance'>(resource?.status === 'maintenance' ? 'maintenance' : 'active');

  const attrErrors = fieldErrors(fields, values);
  const noMode = kind === 'vehicle' && values.with_driver !== true && values.self_drive !== true;
  const errors = {
    name: name.trim().length < 2 ? t(name.trim() ? 'form.short' : 'engine.nameRequired') : null,
    attributes: Object.keys(attrErrors).length ? 'fields' : noMode ? t('engine.chooseMode') : null,
  };

  const save = useMutation({
    mutationFn: (body: object) => (resource ? api.patch<VendorResource>(`/v1/partner/resources/${resource.id}`, body) : api.post<VendorResource>('/v1/partner/resources', body)),
    onSuccess: (saved) => {
      invalidateEngine(qc);
      toast.success(t(resource ? 'engine.resourceSaved' : 'engine.resourceAdded', { name: saved.name }));
      // A new vehicle or driver opens again so its papers can be added straight away.
      if (!resource && DOC_TYPES[kind]) router.replace(`/engine/resource/${saved.id}`);
      else router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/partner/resources/${resource!.id}`),
    onSuccess: () => {
      invalidateEngine(qc);
      toast.success(t('engine.resourceRemoved'));
      router.back();
    },
    onError: (e) => toast.error(errorCode(e) === 'RESOURCE_BOOKED' ? t('engine.resourceBooked') : errorText(t, e)),
  });

  function submit() {
    if (save.isPending || !form.check(errors)) return;
    save.mutate({ ...(resource ? { status } : { kind }), name: name.trim(), attributes: toValues(fields, values) });
  }

  async function confirmRemove() {
    const ok = await confirm({ title: t('catalog.deleteTitleNamed', { name: resource!.name }), body: t('engine.deleteResourceBody'), confirmLabel: t('common.delete'), cancelLabel: t('common.keep'), destructive: true });
    if (ok) remove.mutate();
  }

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={t(resource ? 'engine.editResource' : `engine.addResource.${kind}`)}
      footer={
        <>
          <Button testID="save-resource" size="lg" label={resource ? t('common.saveChanges') : t('common.add')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {resource ? <Button testID="delete-resource" kind="dangerOutline" icon="trash" label={t('common.delete')} loading={remove.isPending} onPress={() => void confirmRemove()} /> : null}
        </>
      }
    >
      {resource && resource.verification !== 'not_required' ? <Verification resource={resource} /> : null}
      <View {...form.at('name')}>
        <Field ref={form.ref('name')} testID="resource-name" label={t(`engine.resourceName.${kind}`)} value={name} onChangeText={setName} onBlur={form.blur('name')} maxLength={80}
          placeholder={t(`engine.resourceNamePlaceholder.${kind}`)} error={form.show('name') ? errors.name : null} />
      </View>
      <View {...form.at('attributes')} style={{ gap: space.md }}>
        {fields.map((f) => (
          <FieldInput key={f.key} field={f} value={values[f.key]} testPrefix="res" onChange={(v) => setValues({ ...values, [f.key]: v })} error={form.show('attributes') ? attrErrors[f.key] : null} />
        ))}
        {form.show('attributes') && noMode ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{t('engine.chooseMode')}</Txt> : null}
      </View>
      {resource ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="bold" size="sm">{t('engine.availability')}</Txt>
          <Segmented options={[{ key: 'active', label: t('engine.status.active') }, { key: 'maintenance', label: t('engine.status.maintenance') }]} value={status} onChange={setStatus} />
          {status === 'maintenance' ? <Txt size="xs" color={c.textMuted}>{t('engine.maintenanceNote')}</Txt> : null}
        </View>
      ) : null}
      {resource && DOC_TYPES[kind] ? <Documents resource={resource} /> : null}
      {!resource && DOC_TYPES[kind] ? <Notice tone="info">{t('engine.docsAfterSave')}</Notice> : null}
    </Screen>
  );
}

const VERIFY_TONE: Record<VendorResource['verification'], Tone> = { not_required: 'neutral', pending: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger' };

function Verification({ resource: r }: { resource: VendorResource }) {
  const { t } = useTranslation();
  return (
    <Notice tone={r.verification === 'approved' ? 'success' : r.verification === 'pending' ? 'info' : 'warning'} title={t(`engine.verification.${r.verification}`)}>
      {r.rejectReason ? `${t(`engine.verificationBody.${r.verification}`)} ${r.rejectReason}` : t(`engine.verificationBody.${r.verification}`)}
    </Notice>
  );
}

function Documents({ resource: r }: { resource: VendorResource }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [choose, setChoose] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function upload(docType: string, source: 'photo' | 'pdf') {
    let file: PickedFile | null;
    if (source === 'pdf') file = await pickPdf();
    else {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      file = res.canceled || !res.assets.length ? null : toPicked(res.assets[0]);
    }
    if (!file) return;
    controller.current = new AbortController();
    setBusy(docType);
    try {
      await uploadResourceDocument(file, r.id, docType, { signal: controller.current.signal });
      void qc.invalidateQueries({ queryKey: engineKeys.resources });
      toast.success(t('docs.uploaded', { doc: t(`engine.doc.${docType}`) }));
    } catch (e) {
      if (errorCode(e) !== 'CANCELLED') toast.error(errorText(t, e));
    } finally {
      controller.current = null;
      setBusy(null);
    }
  }

  const TONE: Record<string, Tone> = { pending: 'warning', approved: 'success', rejected: 'danger' };
  return (
    <Card testID="resource-docs">
      <CardHeader title={t('engine.papers')} />
      <Txt size="xs" color={c.textMuted}>{t('engine.papersHint')}</Txt>
      {(DOC_TYPES[r.kind] ?? []).map((d, i) => {
        const doc = r.documents.find((x) => x.docType === d.type);
        return (
          <Row key={d.type} first={i === 0} testID={`res-doc-${d.type}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size="md" variant="bold">{t(`engine.doc.${d.type}`)}</Txt>
              {doc ? <Pill label={t(`docs.status.${doc.status}`)} tone={TONE[doc.status] ?? 'neutral'} /> : <Txt size="xs" color={c.textMuted}>{d.required ? t('docs.required') : t('docs.optional')}</Txt>}
              {doc?.rejectReason ? <Txt size="sm" color={c.danger}>{doc.rejectReason}</Txt> : null}
            </View>
            {busy === d.type ? (
              <Button testID={`cancel-res-doc-${d.type}`} kind="outline" label={t('upload.cancel')} onPress={() => controller.current?.abort()} />
            ) : (
              <Button testID={`upload-res-doc-${d.type}`} kind={!doc && d.required ? 'primary' : 'secondary'} disabled={!!busy}
                label={doc ? (doc.status === 'rejected' ? t('docs.uploadAgain') : t('common.change')) : t('docs.upload')} onPress={() => setChoose(d.type)} />
            )}
          </Row>
        );
      })}
      <ActionSheet
        visible={!!choose}
        title={choose ? t('docs.sourceTitle', { doc: t(`engine.doc.${choose}`) }) : ''}
        message={t('docs.sourceNote')}
        onClose={() => setChoose(null)}
        actions={[
          { label: t('docs.fromPhotos'), icon: 'image', testID: 'res-doc-source-photo', onPress: () => choose && (setChoose(null), void upload(choose, 'photo')) },
          { label: t('docs.fromPdf'), icon: 'file', testID: 'res-doc-source-pdf', onPress: () => choose && (setChoose(null), void upload(choose, 'pdf')) },
        ]}
      />
    </Card>
  );
}
