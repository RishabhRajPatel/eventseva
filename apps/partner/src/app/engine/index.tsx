import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { rupees, type EngineService, type ServiceSetup, type VendorResource } from '@eventseva/app-shared';
import { missingDocs, resourceKinds, useAddons, useBundles, useEngineServices, useResources, useServiceSetup } from '../../lib/engine';
import { c, space } from '../../lib/theme';
import { LinkButton } from '../../components/Button';
import { Card, CardHeader, Row } from '../../components/Card';
import { Pill, type Tone } from '../../components/Chip';
import { Screen } from '../../components/Screen';
import { EmptyInline, QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Services booked by time or quantity, the vehicles / people / hall they use, extras and bundles. */
export default function EngineHub() {
  const { t } = useTranslation();
  const setup = useServiceSetup();
  const services = useEngineServices();
  return (
    <Screen back title={t('engine.title')} refreshing={services.isRefetching} onRefresh={() => void services.refetch()} testID="engine-hub">
      <QueryView query={setup}>{(s) => <Hub setup={s} />}</QueryView>
    </Screen>
  );
}

function Hub({ setup }: { setup: ServiceSetup }) {
  const { t } = useTranslation();
  const services = useEngineServices();
  const resources = useResources();
  const addons = useAddons();
  const bundles = useBundles();
  const kinds = resourceKinds(setup);
  const serviceCount = services.data?.length ?? 0;

  return (
    <View style={{ gap: space.lg }}>
      <Txt size="sm" color={c.textMuted}>
        {t(`engine.intro.${setup.bookingType}`)}
      </Txt>

      {kinds.length ? (
        <Card>
          <CardHeader title={t(`engine.resources.${kinds[0]}`)} />
          <QueryView query={resources}>
            {(list) => (
              <View>
                {list.length ? (
                  list.map((r, i) => <ResourceRow key={r.id} resource={r} first={i === 0} />)
                ) : (
                  <EmptyInline icon="plus" text={t(`engine.resourcesEmpty.${kinds[0]}`)} />
                )}
                <View style={styles.links}>
                  {kinds.map((k) => (
                    <LinkButton
                      key={k}
                      testID={`add-resource-${k}`}
                      label={t(`engine.addResource.${k}`)}
                      onPress={() =>
                        router.push({
                          pathname: '/engine/resource/[id]',
                          params: { id: 'new', kind: k },
                        })
                      }
                    />
                  ))}
                </View>
              </View>
            )}
          </QueryView>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t('engine.services')} right={<LinkButton testID="add-service" label={t('common.add')} onPress={() => router.push('/engine/service/new')} />} />
        <QueryView query={services}>
          {(list) =>
            list.length ? (
              <View>
                {list.map((s, i) => (
                  <ServiceRow key={s.id} service={s} first={i === 0} />
                ))}
              </View>
            ) : (
              <EmptyInline
                icon="plus"
                text={t('engine.servicesEmpty')}
                action={{
                  label: t('engine.addService'),
                  onPress: () => router.push('/engine/service/new'),
                }}
              />
            )
          }
        </QueryView>
      </Card>

      <Card>
        <CardHeader title={t('engine.addons')} right={<LinkButton testID="add-addon" label={t('common.add')} onPress={() => router.push('/engine/addon/new')} />} />
        <Txt size="xs" color={c.textMuted}>
          {t('engine.addonsHint')}
        </Txt>
        <QueryView query={addons}>
          {(list) => (
            <View>
              {list.map((a, i) => (
                <Row key={a.id} first={i === 0} chevron onPress={() => router.push(`/engine/addon/${a.id}`)} testID={`addon-${a.id}`}>
                  <Txt size="md" style={{ flex: 1 }}>
                    {a.name}
                  </Txt>
                  <Txt size="md" variant="bold">
                    {rupees(a.pricePaise)}
                  </Txt>
                  {a.requiresApproval ? <Pill label={t('engine.askFirst')} tone="info" /> : null}
                </Row>
              ))}
            </View>
          )}
        </QueryView>
      </Card>

      {serviceCount >= 2 ? (
        <Card>
          <CardHeader title={t('engine.bundles')} right={<LinkButton testID="add-bundle" label={t('common.add')} onPress={() => router.push('/engine/bundle/new')} />} />
          <Txt size="xs" color={c.textMuted}>
            {t('engine.bundlesHint')}
          </Txt>
          <QueryView query={bundles}>
            {(list) => (
              <View>
                {list.map((b, i) => (
                  <Row key={b.id} first={i === 0} chevron onPress={() => router.push(`/engine/bundle/${b.id}`)} testID={`bundle-${b.id}`}>
                    <Txt size="md" style={{ flex: 1 }}>
                      {b.name}
                    </Txt>
                    {b.discountPercent ? <Pill label={t('engine.offPercent', { n: b.discountPercent })} tone="success" /> : null}
                  </Row>
                ))}
              </View>
            )}
          </QueryView>
        </Card>
      ) : null}
    </View>
  );
}

const VERIFY_TONE: Record<VendorResource['verification'], Tone> = {
  not_required: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
};

function ResourceRow({ resource: r, first }: { resource: VendorResource; first: boolean }) {
  const { t } = useTranslation();
  // Once verified, nothing is "missing" any more.
  const missing = r.verification === 'approved' ? [] : missingDocs(r);
  const registration = typeof r.attributes.registration === 'string' ? r.attributes.registration : null;
  return (
    <Row first={first} chevron onPress={() => router.push(`/engine/resource/${r.id}`)} testID={`resource-${r.id}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size="md" variant="bold">
          {r.name}
        </Txt>
        <Txt size="xs" color={c.textMuted}>
          {[t(`engine.kind.${r.kind}`), registration].filter(Boolean).join(' · ')}
        </Txt>
        {missing.length ? (
          <Txt size="xs" color={c.onWarning}>
            {t('engine.docsMissing', { count: missing.length })}
          </Txt>
        ) : null}
      </View>
      {r.status !== 'active' ? <Pill label={t(`engine.status.${r.status}`)} tone="neutral" /> : null}
      {r.verification !== 'not_required' ? <Pill label={t(`engine.verification.${r.verification}`)} tone={VERIFY_TONE[r.verification]} /> : null}
    </Row>
  );
}

function ServiceRow({ service: s, first }: { service: EngineService; first: boolean }) {
  const { t } = useTranslation();
  return (
    <Row first={first} chevron onPress={() => router.push(`/engine/service/${s.id}`)} testID={`engine-service-${s.id}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size="md" variant="bold">
          {s.title}
        </Txt>
        <Txt size="xs" color={c.textMuted}>
          {s.pricing.model === 'quote' ? t('engine.model.quote') : `${rupees(s.pricing.ratePaise)} ${t(`engine.per.${s.pricing.model}`)}`}
        </Txt>
      </View>
      {s.rules.approval === 'auto' ? <Pill label={t('engine.instant')} tone="success" /> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
    paddingTop: space.sm,
  },
});
