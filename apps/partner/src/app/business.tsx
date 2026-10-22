import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OwnVendor } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { invalidateVendor, keys, useVendor } from '../lib/queries';
import { isCategoryLocked } from '../lib/routing';
import { BusinessForm, businessPayload, initialBusiness, validateBusiness, type BusinessValues } from '../components/BusinessForm';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';

/** Edit business info from Profile. */
export default function BusinessScreen() {
  const vendor = useVendor();
  return <QueryView query={vendor}>{(v) => (v ? <EditBusiness vendor={v} /> : null)}</QueryView>;
}

function EditBusiness({ vendor }: { vendor: OwnVendor }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = initialBusiness(vendor);
  const [values, setValues] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const onChange = useCallback((v: BusinessValues) => setValues(v), []);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<OwnVendor>('/v1/partner/vendor', body),
    onSuccess: (v) => {
      qc.setQueryData(keys.vendor, v);
      invalidateVendor(qc);
      router.back();
    },
    onError: (e) => Alert.alert(t('errors.title'), errorText(t, e)),
  });

  function submit() {
    setShowErrors(true);
    if (Object.keys(validateBusiness(values)).length) return;
    const body = businessPayload(values, initial);
    if (!Object.keys(body).length) return router.back();
    save.mutate(body);
  }

  return (
    <Screen back title={t('business.title')} footer={<Button testID="save-business" size="lg" label={t('common.save')} loading={save.isPending} onPress={submit} />}>
      {vendor.status === 'pending' ? <Notice icon="lock" tone="warning">{t('errors.underReview')}</Notice> : null}
      <BusinessForm values={values} onChange={onChange} showErrors={showErrors} categoryLocked={isCategoryLocked(vendor.status)} />
    </Screen>
  );
}
