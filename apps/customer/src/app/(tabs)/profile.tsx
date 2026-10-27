// Profile (Profile board): name, phone, saved vendors, language, help, logout.
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '@eventseva/app-shared';
import { PARTNER_APP_URL } from '../../lib/config';
import { useMe, useSession } from '../../lib/session';
import { c, radius, space } from '../../lib/theme';
import { useLayout } from '../../hooks/useLayout';
import { useShortlist } from '../../hooks/useShortlist';
import { AppText } from '../../components/AppText';
import { ListRow, Pill } from '../../components/Bits';
import { useCart } from '../../lib/cart';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { openLink } from '../../lib/links';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const cartCount = useCart().items.length;
  const me = useMe();
  const session = useSession();
  const { gutter, isTablet } = useLayout();
  const shortlist = useShortlist();

  const confirm = useConfirm();
  const toast = useToast();

  // UX.md §4: a question naming the thing, what will happen, and a red button naming the action.
  const confirmLogout = (everywhere: boolean) =>
    confirm({
      title: everywhere ? t('profile.logoutAllTitle') : t('profile.logoutTitle'),
      body: everywhere ? t('profile.logoutAllBody') : t('profile.logoutBody'),
      confirmLabel: everywhere ? t('profile.logoutAllConfirm') : t('profile.logout'),
      cancelLabel: t('profile.stay'),
      busyLabel: t('profile.loggingOut'),
      destructive: true,
      action: () => session.signOut(everywhere),
    });

  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: gutter }, isTablet && styles.tablet]}>
        <View style={styles.head}>
          <View style={styles.avatar}>
            <AppText variant="bold" size="xxl" color={c.white}>
              {(me.name ?? '?').slice(0, 1).toUpperCase()}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="display" size="xxl" accessibilityRole="header" numberOfLines={1}>
              {me.name}
            </AppText>
            <AppText size="sm">{`${formatPhone(me.phone)} · ${t('common.city')}`}</AppText>
          </View>
          <Button label={t('profile.edit')} variant="secondary" size="md" onPress={() => router.push('/edit-profile')} />
        </View>

        <View style={styles.group}>
          <ListRow
            label={t('profile.saved')}
            value={
              <AppText variant="bold" size="md" color={c.royal}>
                {String(shortlist.count)}
              </AppText>
            }
            onPress={() => router.push('/saved')}
          />
          <ListRow label={t('profile.events')} onPress={() => router.navigate('/bookings')} />
          <ListRow label={t('cart.title')} value={cartCount ? String(cartCount) : undefined} onPress={() => router.push('/cart')} />
          <ListRow label={t('licence.title')} onPress={() => router.push('/licence')} />
          <ListRow label={t('profile.city')} value={t('common.city')} onPress={() => toast.info(t('profile.cityOnly'))} />
          <ListRow
            last
            label={t('profile.language')}
            value={
              <AppText size="sm">
                {`${t('language.english')} · `}
                <AppText size="sm" lang="hi">
                  {t('language.hindiNative')}
                </AppText>
              </AppText>
            }
            onPress={() => router.push('/language')}
          />
        </View>

        <View style={styles.group}>
          <ListRow label={t('profile.notifications')} onPress={() => router.push('/notifications')} />
          <ListRow label={t('profile.help')} onPress={() => router.push('/help')} />
          <ListRow
            last
            tone="royal"
            label={t('profile.vendor')}
            value={<Pill label={t('profile.new')} />}
            onPress={() => openLink(PARTNER_APP_URL)}
          />
        </View>

        <View style={styles.group}>
          <ListRow label={t('profile.logout')} onPress={() => confirmLogout(false)} />
          <ListRow label={t('profile.logoutAll')} onPress={() => confirmLogout(true)} />
          <ListRow last tone="danger" label={t('deleteAccount.menu')} onPress={() => router.push('/delete-account')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: space.xxxl, paddingBottom: space.xxxl, gap: space.lg },
  tablet: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingBottom: space.xs },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  group: { backgroundColor: c.white, borderRadius: radius.lg, overflow: 'hidden' },
});
