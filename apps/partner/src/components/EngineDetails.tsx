import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { c, space } from '../lib/theme';
import { Card, CardHeader, Row } from './Card';
import { Pill } from './Chip';
import { Txt } from './Txt';

/** "power_at_venue" → "Power at venue"; the template label is not in the booking, the key reads well enough. */
export const answerLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

export function answerValue(t: TFunction, v: unknown): string {
  if (v === true) return t('common.yes');
  if (v === false) return t('common.no');
  if (Array.isArray(v)) return v.map((x) => answerLabel(String(x))).join(', ');
  return typeof v === 'string' ? answerLabel(v) : String(v);
}

/** Engine bookings: what the customer answered (menu, occasion …) and the extras asked for. */
export function EngineDetails({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const answers = Object.entries(b.answers ?? {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  const addons = b.addons ?? [];
  if (!answers.length && !addons.length) return null;
  return (
    <Card style={{ gap: space.sm }} testID="engine-details">
      {answers.length ? (
        <>
          <CardHeader title={t('engine.customerAnswers')} />
          {answers.map(([k, v], i) => (
            <Row key={k} first={i === 0}>
              <Txt size="sm" color={c.textMuted} style={{ flex: 1 }}>{answerLabel(k)}</Txt>
              <Txt size="sm" variant="bold" style={{ flexShrink: 1 }} align="right">{answerValue(t, v)}</Txt>
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
