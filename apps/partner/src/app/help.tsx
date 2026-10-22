import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, todayIst, type Complaint } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { keys, useBookings, useComplaints } from '../lib/queries';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button } from '../components/Button';
import { Card, CardHeader, Section } from '../components/Card';
import { ChoiceChip, Pill, type Tone } from '../components/Chip';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';
import { Txt } from '../components/Txt';

const STATUS_TONE: Record<Complaint['status'], Tone> = { open: 'warning', in_progress: 'info', resolved: 'success' };

/** Help & support: write to the EventSeva team (optionally about a booking) and see earlier requests. */
export default function HelpScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const complaints = useComplaints();
  const bookings = useBookings();
  const [bookingId, setBookingId] = useState<string | null>(params.bookingId ?? null);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);

  const create = useMutation({
    mutationFn: () => api.post<Complaint>('/v1/complaints', { bookingId: bookingId ?? undefined, subject: subject.trim(), details: details.trim() }),
    onSuccess: () => {
      setSubject('');
      setDetails('');
      setTried(false);
      setSent(true);
      void qc.invalidateQueries({ queryKey: keys.complaints });
    },
    onError: (e) => Alert.alert(t('errors.title'), errorText(t, e)),
  });

  const subjectError = subject.trim().length < 3 ? t('help.subjectShort') : null;
  const detailsError = details.trim().length < 10 ? t('help.detailsShort') : null;
  const recent = (bookings.data ?? []).slice(0, 6);

  return (
    <Screen back title={t('help.title')} refreshing={complaints.isRefetching} onRefresh={() => void complaints.refetch()} testID="help">
      <Txt size="md">{t('help.subtitle')}</Txt>
      {sent ? <Notice icon="check" tone="success">{t('help.sent')}</Notice> : null}
      <Card style={{ gap: space.lg }}>
        <CardHeader title={t('help.newRequest')} />
        {recent.length ? (
          <View style={{ gap: space.xs }}>
            <Txt variant="bold" size="sm">
              {t('help.aboutBooking')}
            </Txt>
            <View style={styles.chips}>
              <ChoiceChip label={t('help.noBooking')} selected={!bookingId} onPress={() => setBookingId(null)} />
              {recent.map((b) => (
                <ChoiceChip key={b.id} label={`${b.event.title} · ${formatDay(b.day, lang)}`} selected={bookingId === b.id} onPress={() => setBookingId(b.id)} />
              ))}
            </View>
          </View>
        ) : null}
        <Field testID="help-subject" label={t('help.subject')} value={subject} onChangeText={setSubject} maxLength={120} placeholder={t('help.subjectPlaceholder')} error={tried ? subjectError : null} />
        <Field testID="help-details" label={t('help.details')} value={details} onChangeText={setDetails} multiline maxLength={2000} placeholder={t('help.detailsPlaceholder')} error={tried ? detailsError : null} />
        <Button
          testID="send-complaint"
          label={t('help.send')}
          loading={create.isPending}
          onPress={() => {
            setTried(true);
            setSent(false);
            if (!subjectError && !detailsError) create.mutate();
          }}
        />
      </Card>
      <Section title={t('help.history')}>
        <QueryView query={complaints}>
          {(items) =>
            items.length ? (
              <View style={{ gap: space.md }}>
                {items.map((cpl) => (
                  <Card key={cpl.id} testID={`complaint-${cpl.id}`}>
                    <View style={styles.head}>
                      <Txt variant="bold" size="md" style={{ flex: 1 }}>
                        {cpl.subject}
                      </Txt>
                      <Pill label={t(`complaintStatus.${cpl.status}`)} tone={STATUS_TONE[cpl.status]} />
                    </View>
                    <Txt size="xs" color={c.textMuted}>
                      {formatDay(todayIst(new Date(cpl.createdAt)), lang)}
                    </Txt>
                    <Txt size="sm" numberOfLines={3}>
                      {cpl.details}
                    </Txt>
                    {cpl.resolution ? <Notice tone="success" title={t('help.resolution')}>{cpl.resolution}</Notice> : null}
                  </Card>
                ))}
              </View>
            ) : (
              <Txt size="sm" color={c.textMuted}>
                {t('help.noHistory')}
              </Txt>
            )
          }
        </QueryView>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
