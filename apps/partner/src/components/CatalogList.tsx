import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { rupees, type OwnVendor } from '@eventseva/app-shared';
import { unitLabel } from '../lib/labels';
import { c, space } from '../lib/theme';
import { LinkButton } from './Button';
import { Card, CardHeader, Row } from './Card';
import { Txt } from './Txt';

/** Services and packages with prices; each row opens its editor. */
export function CatalogList({ vendor, editable }: { vendor: OwnVendor; editable: boolean }) {
  const { t } = useTranslation();
  const empty = vendor.services.length + vendor.packages.length === 0;
  return (
    <Card testID="catalog">
      <CardHeader title={t('catalog.title')} />
      {empty ? (
        <Txt size="sm" color={c.textMuted}>
          {t('catalog.empty')}
        </Txt>
      ) : null}
      {vendor.services.map((s) => (
        <Row key={s.id} testID={`service-${s.id}`} onPress={editable ? () => router.push(`/service/${s.id}`) : undefined} chevron={editable}>
          <View style={{ flex: 1 }}>
            <Txt size="md" numberOfLines={1}>
              {s.title}
            </Txt>
            <Txt size="xs" color={c.textMuted}>
              {unitLabel(t, s.unit)}
            </Txt>
          </View>
          <Txt variant="bold" size="md" color={c.royal}>
            {rupees(s.pricePaise)}
          </Txt>
        </Row>
      ))}
      {vendor.packages.map((p) => (
        <Row key={p.id} testID={`package-${p.id}`} onPress={editable ? () => router.push(`/package/${p.id}`) : undefined} chevron={editable}>
          <View style={{ flex: 1 }}>
            <Txt size="md" numberOfLines={1}>
              {p.title}
            </Txt>
            <Txt size="xs" color={c.textMuted} numberOfLines={1}>
              {t('catalog.packageOf', { items: p.items.join(' · ') })}
            </Txt>
          </View>
          <Txt variant="bold" size="md" color={c.royal}>
            {rupees(p.pricePaise)}
          </Txt>
        </Row>
      ))}
      {editable ? (
        <View style={{ flexDirection: 'row', gap: space.xl, borderTopWidth: 1, borderTopColor: c.lavender }}>
          <LinkButton testID="new-service" label={t('catalog.newService')} onPress={() => router.push('/service/new')} />
          <LinkButton testID="new-package" label={t('catalog.newPackage')} onPress={() => router.push('/package/new')} />
        </View>
      ) : null}
      <Txt size="xs" color={c.textMuted}>
        {t('catalog.note')}
      </Txt>
    </Card>
  );
}
