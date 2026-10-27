import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OwnVendor } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { toast } from '../../lib/toast';
import { invalidateVendor, keys, useVendor } from '../../lib/queries';
import { space } from '../../lib/theme';
import { BusinessForm, businessPayload, initialBusiness, validateBusiness, type BusinessValues } from '../../components/BusinessForm';
import { Button, LinkButton } from '../../components/Button';
import { useSession } from '../../lib/session';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { StepHeader } from '../../components/StepHeader';
import { Txt } from '../../components/Txt';

/** Step 1: business name, category, area and about (VendorOnboard board). */
export default function OnboardingBusiness() {
  const vendor = useVendor();
  return (
    <QueryView query={vendor}>
      {(v) => <BusinessStep vendor={v} />}
    </QueryView>
  );
}

function BusinessStep({ vendor }: { vendor: OwnVendor | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { signOut } = useSession();
  const [values, setValues] = useState<BusinessValues>(() => initialBusiness(vendor));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const onChange = useCallback((v: BusinessValues) => setValues(v), []);

  // Pending or live profiles do not belong here.
  useEffect(() => {
    if (vendor && !['draft', 'rejected'].includes(vendor.status)) router.replace('/');
  }, [vendor]);

  async function next() {
    setShowErrors(true);
    if (saving || Object.keys(validateBusiness(values)).length) return;
    setSaving(true);
    try {
      const saved = vendor
        ? await api.patch<OwnVendor>('/v1/partner/vendor', businessPayload(values, initialBusiness(vendor)))
        : await api.post<OwnVendor>('/v1/partner/vendor', businessPayload(values));
      qc.setQueryData(keys.vendor, saved);
      invalidateVendor(qc);
      router.push('/onboarding/services');
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={<Button testID="continue" size="lg" label={t('common.continue')} loading={saving} onPress={() => void next()} />}>
      <View style={{ gap: space.lg, paddingTop: space.lg }}>
        <StepHeader step={1} label={t('onboarding.step1')} />
        <View style={{ gap: 6 }}>
          <Txt variant="display" size="display" accessibilityRole="header">
            {t('onboarding.businessTitle')}
          </Txt>
          <Txt size="md">{t('onboarding.businessSubtitle')}</Txt>
        </View>
      </View>
      <BusinessForm values={values} onChange={onChange} showErrors={showErrors} />
      {!vendor ? <LinkButton label={t('profile.logout')} onPress={() => void signOut()} /> : null}
    </Screen>
  );
}
