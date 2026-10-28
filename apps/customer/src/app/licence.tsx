// Driving licence for self-drive cars: number, date of birth and expiry. EventSeva checks it before the
// first handover; the number is stored encrypted and only the last 4 digits are shown again.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { licenceProblem } from '../lib/engine';
import { LicencePhotoError, pickAndUploadLicence, type LicencePhoto } from '../lib/licencePhoto';
import { c, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from '../components/AppText';
import { Notice, Pill } from '../components/Bits';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Screen, ScreenHeader } from '../components/Screen';
import { CardsSkeleton } from '../components/Skeleton';
import { ErrorState } from '../components/States';
import { useToast } from '../components/Toast';

export default function LicenceScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const toast = useToast();
  const licence = useQuery({ queryKey: ['licence'], queryFn: api.licence });
  const [number, setNumber] = useState('');
  const [dob, setDob] = useState('');
  const [expires, setExpires] = useState('');
  const [tried, setTried] = useState(false);
  const [photo, setPhoto] = useState<LicencePhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const problem = licenceProblem(number, dob, expires);
  const save = useMutation({
    mutationFn: () => api.saveLicence({ number: number.trim(), dateOfBirth: dob.trim(), expiresOn: expires.trim(), ...(photo ? { photo } : {}) }),
    onSuccess: (saved) => {
      qc.setQueryData(['licence'], saved);
      toast.success(t('licence.saved'));
      if (router.canGoBack()) router.back();
    },
  });

  if (licence.isPending) {
    return (
      <Screen>
        <ScreenHeader title={t('licence.title')} />
        <CardsSkeleton count={2} height={90} />
      </Screen>
    );
  }
  if (licence.error) {
    return (
      <Screen>
        <ScreenHeader title={t('licence.title')} />
        <ErrorState error={licence.error} onRetry={() => licence.refetch()} />
      </Screen>
    );
  }
  const current = licence.data;
  return (
    <Screen
      scroll
      keyboard
      footer={
        <Button
          label={current ? t('licence.update') : t('licence.save')}
          loadingLabel={t('licence.saving')}
          onPress={async () => {
            setTried(true);
            if (problem) return false;
            await save.mutateAsync();
          }}
        />
      }
    >
      <ScreenHeader title={t('licence.title')} />
      <AppText size="sm">{t('licence.why')}</AppText>
      {current ? (
        <View style={styles.current} testID="licence-current">
          <View style={styles.row}>
            <AppText variant="bold" size="md" style={styles.flex}>{t('licence.ending', { last4: current.last4 })}</AppText>
            <Pill label={t(`licence.status.${current.status}`)} tone={current.status === 'verified' ? 'mint' : current.status === 'pending' ? 'peach' : 'lavender'} />
          </View>
          <AppText size="sm">{t('licence.validTill', { date: formatDay(current.expiresOn.slice(0, 10), lang) })}</AppText>
          {current.rejectReason ? <AppText size="sm" color={c.danger}>{current.rejectReason}</AppText> : null}
        </View>
      ) : null}
      <TextField label={t('licence.number')} placeholder="UP70 20190012345" value={number} onChangeText={setNumber} autoCapitalize="characters" maxLength={25}
        error={tried && problem === 'number' ? t('licence.numberError') : null} />
      <TextField label={t('licence.dob')} placeholder="1995-04-23" value={dob} onChangeText={setDob} keyboardType="numbers-and-punctuation" maxLength={10}
        error={tried && problem === 'dob' ? t('licence.dateError') : null} />
      <TextField label={t('licence.expires')} placeholder="2034-04-22" value={expires} onChangeText={setExpires} keyboardType="numbers-and-punctuation" maxLength={10}
        error={tried && problem === 'expires' ? t('licence.dateError') : tried && problem === 'expired' ? t('licence.expired') : null} />
      <View style={styles.photo}>
        <Button
          label={photo ? t('licence.photoAdded') : current?.hasPhoto ? t('licence.photoReplace') : t('licence.photoAdd')}
          icon={photo ? 'checkCircle' : 'plus'}
          variant="outline"
          size="md"
          loading={uploading}
          loadingLabel={t('licence.photoUploading')}
          onPress={async () => {
            setPhotoError(null);
            setUploading(true);
            try {
              const p = await pickAndUploadLicence();
              if (p) setPhoto(p);
            } catch (e) {
              setPhotoError(e instanceof LicencePhotoError && e.code === 'FILE_TOO_BIG' ? t('licence.photoTooBig') : errorText(t, e));
            } finally {
              setUploading(false);
            }
          }}
        />
        <AppText size="xs" color={c.textMuted}>{t('licence.photoHint')}</AppText>
        {photoError ? <AppText size="sm" color={c.danger}>{photoError}</AppText> : null}
      </View>
      <Notice icon="lock">{t('licence.privacy')}</Notice>
      {save.error ? <AppText size="sm" color={c.danger}>{errorText(t, save.error)}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  current: { gap: space.xs, padding: space.md, borderRadius: 12, backgroundColor: c.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  photo: { gap: space.xs },
});
