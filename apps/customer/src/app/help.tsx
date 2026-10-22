// Help & support: raise a complaint (optionally about a booking) and see earlier ones.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, type Complaint } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { keys } from '../lib/queryClient';
import { c, radius, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from '../components/AppText';
import { Card, Notice, Pill, SectionTitle } from '../components/Bits';
import { Button } from '../components/Button';
import { Chip, TextField } from '../components/Form';
import { Screen, ScreenHeader } from '../components/Screen';
import { ErrorState, Loading } from '../components/States';

const STATUS_TONE = { open: 'peach', in_progress: 'lavender', resolved: 'mint' } as const;

export default function HelpScreen() {
  const { bookingId: fromBooking } = useLocalSearchParams<{ bookingId?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const complaints = useQuery({ queryKey: keys.complaints, queryFn: api.complaints });
  const bookings = useQuery({ queryKey: keys.bookings(), queryFn: () => api.bookings() });
  const [bookingId, setBookingId] = useState<string | undefined>(fromBooking);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<{ subject?: string; details?: string }>({});

  const create = useMutation({
    mutationFn: api.createComplaint,
    onSuccess: () => {
      setSent(true);
      setSubject('');
      setDetails('');
      void qc.invalidateQueries({ queryKey: keys.complaints });
    },
  });

  function submit() {
    const e: typeof errors = {};
    if (subject.trim().length < 3) e.subject = t('help.subjectShort');
    if (details.trim().length < 10) e.details = t('help.detailsShort');
    setErrors(e);
    setSent(false);
    if (!e.subject && !e.details) create.mutate({ bookingId, subject: subject.trim(), details: details.trim() });
  }

  const recent = (bookings.data?.items ?? []).slice(0, 8);

  return (
    <Screen scroll keyboard>
      <ScreenHeader title={t('help.title')} />
      <AppText size="md">{t('help.intro')}</AppText>
      {sent ? (
        <Notice icon="checkCircle" tone="mint">
          {t('help.sent')}
        </Notice>
      ) : null}

      <Card style={styles.form}>
        {recent.length ? (
          <View style={styles.gap8}>
            <AppText variant="bold" size={14}>
              {t('help.about')}
            </AppText>
            <View style={styles.chips}>
              <Chip label={t('help.general')} selected={!bookingId} onPress={() => setBookingId(undefined)} />
              {recent.map((b) => (
                <Chip key={b.id} label={`${b.vendor.businessName} · ${formatDay(b.day, lang)}`} selected={bookingId === b.id} onPress={() => setBookingId(b.id)} />
              ))}
            </View>
          </View>
        ) : null}
        <TextField label={t('help.subject')} placeholder={t('help.subjectPlaceholder')} value={subject} onChangeText={setSubject} maxLength={120} error={errors.subject} />
        <TextField
          label={t('help.details')}
          placeholder={t('help.detailsPlaceholder')}
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={2000}
          error={errors.details ?? (create.error ? errorText(t, create.error) : null)}
        />
        <Button label={t('help.send')} onPress={submit} loading={create.isPending} />
      </Card>

      <SectionTitle title={t('help.yours')} />
      {complaints.isPending ? (
        <Loading />
      ) : complaints.error ? (
        <ErrorState error={complaints.error} onRetry={() => complaints.refetch()} />
      ) : complaints.data.items.length === 0 ? (
        <AppText size="md">{t('help.none')}</AppText>
      ) : (
        complaints.data.items.map((cp) => <ComplaintCard key={cp.id} complaint={cp} />)
      )}
    </Screen>
  );
}

function ComplaintCard({ complaint: cp }: { complaint: Complaint }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.complaint}>
      <View style={styles.row}>
        <AppText variant="bold" size="md" style={styles.flex}>
          {cp.subject}
        </AppText>
        <Pill label={t(`help.status.${cp.status}`)} tone={STATUS_TONE[cp.status]} />
      </View>
      <AppText size="xs" color={c.textMuted}>
        {formatDay(cp.createdAt.slice(0, 10), lang)}
      </AppText>
      <AppText size="sm" numberOfLines={open ? undefined : 2}>
        {cp.details}
      </AppText>
      {cp.resolution ? (
        <View style={styles.resolution}>
          <AppText variant="bold" size="sm">
            {t('help.reply')}
          </AppText>
          <AppText size="sm">{cp.resolution}</AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap8: { gap: space.sm },
  form: { padding: space.lg, gap: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  complaint: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resolution: { backgroundColor: c.mintLight, borderRadius: radius.sm, padding: space.sm, marginTop: space.xs },
});
