import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useVendor } from '../lib/queries';
import { routeFor } from '../lib/routing';
import { useSession } from '../lib/session';
import { c, radius, space } from '../lib/theme';
import { Button, LinkButton } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

type StepState = 'done' | 'current' | 'next';

/** "Under review" (VendorPending board). Pull down to check again; nothing is editable meanwhile. */
export default function Pending() {
  const { t } = useTranslation();
  const { me, signOut } = useSession();
  const vendor = useVendor();
  const status = vendor.data?.status;

  // Approved or rejected while the vendor was waiting: move on.
  useEffect(() => {
    if (status && status !== 'pending') router.replace(routeFor({ name: me?.name ?? 'x', vendorStatus: status }));
  }, [status, me?.name]);

  const steps: Array<{ key: string; state: StepState }> = [
    { key: 'business', state: 'done' },
    { key: 'documents', state: 'done' },
    { key: 'approval', state: 'current' },
    { key: 'live', state: 'next' },
  ];

  return (
    <Screen
      testID="pending"
      refreshing={vendor.isRefetching}
      onRefresh={() => void vendor.refetch()}
      footer={
        <>
          <Button testID="check-again" size="lg" label={t('pending.checkAgain')} loading={vendor.isRefetching} onPress={() => void vendor.refetch()} />
          <Button size="lg" kind="secondary" label={t('pending.talkToTeam')} onPress={() => router.push('/help')} />
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.clock}>
          <Icon name="clock" size={40} strokeWidth={1.8} />
        </View>
        <Txt variant="display" size="display" align="center" accessibilityRole="header">
          {t('pending.title')}
        </Txt>
        <Txt size="md" align="center" style={{ lineHeight: 22 }}>
          {t('pending.body')}
        </Txt>
      </View>
      <Card style={{ gap: space.lg, paddingVertical: space.xl }}>
        {steps.map((s, i) => (
          <View key={s.key} style={styles.step}>
            <View style={[styles.dot, { backgroundColor: s.state === 'done' ? c.mint : s.state === 'current' ? c.royal : c.lavender }]}>
              {s.state === 'done' ? (
                <Icon name="check" size={16} strokeWidth={2.5} />
              ) : (
                <Txt variant="bold" size="sm" color={s.state === 'current' ? c.white : c.royal}>
                  {i + 1}
                </Txt>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bold" size="md">
                {t(`pending.steps.${s.key}`)}
              </Txt>
              <Txt size="sm" color={c.textMuted}>
                {t(`pending.steps.${s.key}Sub`)}
              </Txt>
            </View>
          </View>
        ))}
      </Card>
      <View style={styles.note}>
        <Txt size="sm" style={{ lineHeight: 21 }}>
          {t('pending.lockedNote')}
        </Txt>
      </View>
      <LinkButton label={t('profile.logout')} color={c.ink} onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xxl },
  clock: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.peach, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  note: { borderRadius: radius.md, backgroundColor: c.lavender, padding: space.md, paddingHorizontal: space.lg },
});
