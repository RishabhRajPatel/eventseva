import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useVendor } from '../../lib/queries';
import { space } from '../../lib/theme';
import { Button } from '../../components/Button';
import { CatalogList } from '../../components/CatalogList';
import { Notice } from '../../components/Notice';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { StepHeader } from '../../components/StepHeader';
import { Txt } from '../../components/Txt';

/** Step 2: at least one service or package with a price. */
export default function OnboardingServices() {
  const { t } = useTranslation();
  const vendor = useVendor();
  const count = (vendor.data?.services.length ?? 0) + (vendor.data?.packages.length ?? 0);
  return (
    <Screen
      back
      refreshing={vendor.isRefetching}
      onRefresh={() => void vendor.refetch()}
      footer={<Button testID="continue" size="lg" label={t('common.continue')} disabled={!count} onPress={() => router.push('/onboarding/submit')} />}
    >
      <View style={{ gap: space.lg }}>
        <StepHeader step={2} label={t('onboarding.step2')} />
        <View style={{ gap: 6 }}>
          <Txt variant="display" size="display" accessibilityRole="header">
            {t('onboarding.servicesTitle')}
          </Txt>
          <Txt size="md">{t('onboarding.servicesSubtitle')}</Txt>
        </View>
      </View>
      <QueryView query={vendor}>{(v) => (v ? <CatalogList vendor={v} editable /> : null)}</QueryView>
      {!count ? <Notice icon="alert">{t('onboarding.servicesNeeded')}</Notice> : null}
    </Screen>
  );
}
