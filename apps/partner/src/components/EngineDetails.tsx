import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { answerRows } from '../lib/engine';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Card, CardHeader, Row } from './Card';
import { Pill } from './Chip';
import { Txt } from './Txt';

/** Engine bookings: what the customer answered (menu, occasion …) and the extras asked for. */
export function EngineDetails({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const lang = useLang();
  const answers = answerRows(b, lang);
  const addons = b.addons ?? [];
  if (!answers.length && !addons.length) return null;
  return (
    <Card style={{ gap: space.sm }} testID="engine-details">
      {answers.length ? (
        <>
          <CardHeader title={t('engine.customerAnswers')} />
          {answers.map((a, i) => (
            <Row key={a.key} first={i === 0}>
              <Txt size="sm" color={c.textMuted} style={{ flex: 1 }}>{a.label}</Txt>
              <Txt size="sm" variant="bold" style={{ flexShrink: 1 }} align="right">
                {a.value === true ? t('common.yes') : a.value === false ? t('common.no') : String(a.value)}
              </Txt>
            </Row>
          ))}
        </>
      ) : null}
      {addons.length ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="bold" size="sm">{t('engine.addonsAsked')}</Txt>
          {addons.map((a) => (
            <Row key={a.addonId} first>
              <Txt size="sm" style={{ flex: 1 }}>{a.note ? `${a.name} · “${a.note}”` : a.name}</Txt>
              <Txt size="sm" variant="bold">{rupees(a.pricePaise)}</Txt>
              <Pill label={t(`engine.addonStatus.${a.status}`)} tone={a.status === 'declined' ? 'neutral' : a.status === 'pending_approval' ? 'warning' : 'success'} />
            </Row>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
