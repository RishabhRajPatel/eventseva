import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type OwnVendor } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorCode, errorText } from '../../lib/errors';
import { usablePhotoCount } from '../../lib/media';
import { invalidateVendor, keys, useVendor } from '../../lib/queries';
import { routeFor } from '../../lib/routing';
import { toast } from '../../lib/toast';
import { useSession } from '../../lib/session';
import { c, radius, space } from '../../lib/theme';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import { Button, LinkButton } from '../../components/Button';
import { Card, CardHeader, Row } from '../../components/Card';
import { DocumentsCard } from '../../components/DocumentsCard';
import { Icon } from '../../components/Icon';
import { MediaGrid } from '../../components/MediaGrid';
import { Notice } from '../../components/Notice';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { StepHeader } from '../../components/StepHeader';
import { Txt } from '../../components/Txt';

type Missing = OwnVendor['missingForReview'][number];

/** Step 3: documents, photos and the checklist, then Submit for verification (VendorDocs board). */
export default function OnboardingSubmit() {
  const vendor = useVendor();
  return <QueryView query={vendor}>{(v) => (v ? <SubmitStep vendor={v} refetch={() => void vendor.refetch()} refreshing={vendor.isRefetching} /> : null)}</QueryView>;
}

function SubmitStep({ vendor, refetch, refreshing }: { vendor: OwnVendor; refetch: () => void; refreshing: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { me, signOut } = useSession();
  const upload = usePhotoUpload({ media: vendor.media });
  const [serverMissing, setServerMissing] = useState<Missing[] | null>(null);
  const missing = serverMissing ?? vendor.missingForReview;

  const submit = useMutation({
    mutationFn: () => api.post<OwnVendor>('/v1/partner/vendor/submit'),
    onSuccess: (v) => {
      qc.setQueryData(keys.vendor, v);
      invalidateVendor(qc);
      toast.success(t('onboarding.submitted'));
      router.replace(routeFor({ name: me?.name ?? 'x', vendorStatus: v.status }));
    },
    onError: (e) => {
      if (errorCode(e) === 'VENDOR_INCOMPLETE' && e instanceof ApiError && Array.isArray(e.details.missing)) {
        setServerMissing(e.details.missing as Missing[]);
        refetch();
      }
      toast.error(errorText(t, e));
    },
  });

  const checklist: Array<{ key: string; done: boolean; onPress: () => void }> = [
    { key: 'area', done: !missing.includes('area'), onPress: () => router.push('/onboarding') },
    { key: 'about', done: !missing.includes('about'), onPress: () => router.push('/onboarding') },
    { key: 'services', done: !missing.includes('services_or_packages'), onPress: () => router.push('/onboarding/services') },
    { key: 'photos', done: !missing.includes('photos'), onPress: () => router.push('/photos') },
  ];

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refetch}
      footer={
        <Button
          testID="submit"
          size="lg"
          label={vendor.status === 'rejected' ? t('onboarding.resubmit') : t('onboarding.submit')}
          loading={submit.isPending}
          loadingLabel={t('onboarding.submitting')}
          disabled={missing.length > 0}
          accessibilityHint={missing.length ? t('onboarding.submitHint') : undefined}
          onPress={() => {
            if (!submit.isPending) submit.mutate();
          }}
        />
      }
    >
      <View style={{ gap: space.lg, paddingTop: space.lg }}>
        <StepHeader step={3} label={t('onboarding.step3')} />
        <View style={{ gap: 6 }}>
          <Txt variant="display" size="display" accessibilityRole="header">
            {t('onboarding.submitTitle')}
          </Txt>
          <Txt size="md">{t('onboarding.submitSubtitle')}</Txt>
        </View>
      </View>

      {vendor.status === 'rejected' ? (
        <Notice testID="reject-reason" tone="danger" icon="alert" title={t('onboarding.rejectedTitle')}>
          <Txt size="md" style={{ lineHeight: 22 }}>
            {vendor.rejectReason || t('onboarding.rejectedNoReason')}
          </Txt>
          <Txt size="sm">{t('onboarding.rejectedHelp')}</Txt>
        </Notice>
      ) : null}

      <Card testID="checklist">
        <CardHeader title={t('onboarding.checklist')} />
        {checklist.map((item, i) => (
          <Row key={item.key} first={i === 0} onPress={item.onPress} chevron testID={`check-${item.key}`}>
            <View style={styles.checkRow}>
              <View style={[styles.dot, { backgroundColor: item.done ? c.mint : c.peach }]}>
                <Icon name={item.done ? 'check' : 'alert'} size={14} strokeWidth={2.5} />
              </View>
              <Txt size="md" style={{ flex: 1 }}>
                {t(`onboarding.check.${item.key}`)}
              </Txt>
            </View>
            <Txt size="xs" variant="bold" color={item.done ? c.textMuted : c.royal}>
              {item.done ? t('onboarding.done') : t('onboarding.fix')}
            </Txt>
          </Row>
        ))}
      </Card>

      <DocumentsCard />

      <Card>
        <CardHeader
          title={t('photos.workPhotos')}
          right={
            <Txt size="sm" color={c.textMuted}>
              {t('photos.countMin', { n: usablePhotoCount(vendor.media), min: 1 })}
            </Txt>
          }
        />
        <MediaGrid
          media={vendor.media}
          uploads={upload.items}
          columns={4}
          compact
          onAdd={() => void upload.pick()}
          canAdd={upload.canAdd}
          onOpen={() => router.push('/photos')}
          onCancelUpload={upload.cancel}
          onRetryUpload={upload.retry}
          onDismissUpload={upload.dismiss}
        />
        <Txt size="xs" color={c.textMuted}>
          {t('photos.guidelines')}
        </Txt>
      </Card>

      <View style={styles.links}>
        <LinkButton label={t('onboarding.editBusiness')} onPress={() => router.push('/onboarding')} />
        <LinkButton label={t('profile.help')} onPress={() => router.push('/help')} />
        <LinkButton label={t('profile.logout')} color={c.ink} onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  checkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl },
});
