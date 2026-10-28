// What changed on one of the vendor's services (price, rules, questions, ways to book, events), newest
// first. Bookings already made keep what was agreed; this is the record of the listing itself.
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type ServiceConfigChange } from '@eventseva/app-shared';
import { api } from '../../../lib/api';
import { STALE } from '../../../lib/queries';
import { c, space } from '../../../lib/theme';
import { useLang } from '../../../hooks/useLang';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { QueryView } from '../../../components/States';
import { Txt } from '../../../components/Txt';

const KNOWN = ['pricing', 'rules', 'questions', 'plans', 'eventTypes', 'active'] as const;

export default function ServiceHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const lang = useLang();
  const history = useQuery({
    queryKey: ['engine', 'history', id],
    queryFn: async () => (await api.get<{ items: ServiceConfigChange[] }>(`/v1/partner/engine-services/${id}/history`)).items,
    staleTime: STALE.list,
  });
  return (
    <Screen back title={t('serviceConfig.history')}>
      <QueryView query={history}>
        {(items) =>
          items.length ? (
            <>
              {items.map((h) => (
                <Card key={h.version} style={{ gap: space.xs }} testID={`history-${h.version}`}>
                  <Txt variant="bold" size="md">{t('serviceConfig.historyVersion', { n: h.version })}</Txt>
                  <Txt size="sm" color={c.textMuted}>{formatDateTime(h.createdAt, lang)}</Txt>
                  <Txt size="sm">
                    {KNOWN.filter((k) => k in h.changes).map((k) => t(`serviceConfig.changed.${k}`)).join(', ')}
                  </Txt>
                  {typeof (h.changes as { note?: unknown }).note === 'string' ? <Txt size="sm">{(h.changes as { note: string }).note}</Txt> : null}
                </Card>
              ))}
            </>
          ) : (
            <Txt size="sm" color={c.textMuted}>{t('serviceConfig.historyEmpty')}</Txt>
          )
        }
      </QueryView>
    </Screen>
  );
}
