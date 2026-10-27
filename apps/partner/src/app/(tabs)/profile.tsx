import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { rupees, type OwnVendor } from '@eventseva/app-shared';
import { canEdit, isCategoryLocked } from '../../lib/routing';
import { coverOf, thumbUrl } from '../../lib/media';
import { useDashboard, useVendor } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { confirm } from '../../lib/confirm';
import { istDay, vendorStatus } from '../../lib/labels';
import { c, radius, space } from '../../lib/theme';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import { useIsTablet } from '../../hooks/useIsTablet';
import { useLang } from '../../hooks/useLang';
import { BankCard } from '../../components/Banners';
import { LinkButton } from '../../components/Button';
import { Card, CardHeader, Row } from '../../components/Card';
import { CatalogList } from '../../components/CatalogList';
import { Pill } from '../../components/Chip';
import { CategoryIcon, Icon, type IconName } from '../../components/Icon';
import { MediaGrid } from '../../components/MediaGrid';
import { Notice } from '../../components/Notice';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Profile tab (VendorProfile board): catalogue, photos, business info, bank and settings. */
export default function Profile() {
  const vendor = useVendor();
  return (
    <Screen inTabs refreshing={vendor.isRefetching} onRefresh={() => void vendor.refetch()} testID="profile">
      <QueryView query={vendor}>{(v) => (v ? <ProfileBody vendor={v} /> : null)}</QueryView>
    </Screen>
  );
}

function ProfileBody({ vendor }: { vendor: OwnVendor }) {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const dashboard = useDashboard();
  const tablet = useIsTablet();
  const lang = useLang();
  const editable = canEdit(vendor.status);
  const upload = usePhotoUpload({ media: vendor.media });
  const cover = coverOf(vendor.media);
  const coverUrl = cover ? thumbUrl(cover, 56, 56) : null;
  const status = vendor.status === 'approved' ? { label: t('home.verified'), tone: 'success' as const } : vendorStatus(t, vendor.status);

  const menu: Array<{ icon: IconName; label: string; value?: string; onPress: () => unknown; testID: string }> = [
    { icon: 'rupee', label: t('profile.earnings'), value: dashboard.data ? t('profile.thisMonth', { amount: rupees(dashboard.data.monthEarningsPaise) }) : undefined, onPress: () => router.push('/earnings'), testID: 'menu-earnings' },
    {
      icon: 'search',
      label: t('profile.featured'),
      value: vendor.featuredUntil ? t('profile.featuredUntil', { day: istDay(vendor.featuredUntil, lang) }) : undefined,
      onPress: () => router.push('/featured'),
      testID: 'menu-featured',
    },
    { icon: 'star', label: t('profile.reviews'), value: vendor.rating.count ? `★ ${vendor.rating.avg.toFixed(1)}` : undefined, onPress: () => router.push('/reviews'), testID: 'menu-reviews' },
    { icon: 'bell', label: t('notifications.title'), onPress: () => router.push('/notifications'), testID: 'menu-notifications' },
    { icon: 'lock', label: t('profile.documents'), onPress: () => router.push('/documents'), testID: 'menu-documents' },
    { icon: 'globe', label: t('profile.language'), value: t('profile.languageValue'), onPress: () => router.push('/language'), testID: 'menu-language' },
    { icon: 'help', label: t('profile.help'), onPress: () => router.push('/help'), testID: 'menu-help' },
    { icon: 'trash', label: t('deleteAccount.menu'), onPress: () => router.push('/delete-account'), testID: 'menu-delete-account' },
    {
      icon: 'logout',
      label: t('profile.logout'),
      testID: 'menu-logout',
      onPress: async () => {
        const ok = await confirm({ title: t('profile.logoutTitle'), body: t('profile.logoutBody'), confirmLabel: t('profile.logout'), cancelLabel: t('common.stay'), destructive: true });
        if (ok) await signOut();
      },
    },
  ];

  const left = (
    <>
      <CatalogList vendor={vendor} editable={editable} />
      <Card>
        <CardHeader
          title={t('photos.title')}
          right={<LinkButton testID="manage-photos" label={t('photos.manage', { n: vendor.media.length })} onPress={() => router.push('/photos')} />}
        />
        <MediaGrid
          compact
          media={vendor.media.slice(0, 9)}
          uploads={upload.items}
          onAdd={editable ? () => void upload.pick() : undefined}
          canAdd={upload.canAdd}
          onOpen={() => router.push('/photos')}
          onCancelUpload={upload.cancel}
          onRetryUpload={upload.retry}
          onDismissUpload={upload.dismiss}
        />
      </Card>
      <Card>
        <CardHeader title={t('business.title')} right={editable ? <LinkButton testID="edit-business" label={t('common.change')} onPress={() => router.push('/business')} /> : null} />
        <Row first>
          <Txt size="md">{t('business.category')}</Txt>
          <Txt variant="bold" size="md">
            {vendor.category.name}
          </Txt>
        </Row>
        <Row>
          <Txt size="md">{t('business.area')}</Txt>
          <Txt variant="bold" size="md" style={{ flexShrink: 1 }} align="right">
            {[vendor.area, vendor.city.name].filter(Boolean).join(', ')}
          </Txt>
        </Row>
        <Txt size="xs" color={c.textMuted}>
          {isCategoryLocked(vendor.status) ? t('business.categoryLocked') : t('business.reviewNote')}
        </Txt>
      </Card>
    </>
  );
  const right = (
    <>
      <BankCard />
      <Card style={{ paddingVertical: space.xs }}>
        {menu.map((m, i) => (
          <Row key={m.testID} first={i === 0} onPress={() => void m.onPress()} testID={m.testID} chevron>
            <View style={styles.menuLabel}>
              <Icon name={m.icon} size={18} color={c.royal} />
              <Txt size="md">{m.label}</Txt>
            </View>
            {m.value ? (
              <Txt size="sm" variant="bold" color={c.royal}>
                {m.value}
              </Txt>
            ) : null}
          </Row>
        ))}
      </Card>
    </>
  );

  return (
    <>
      <View style={styles.head}>
        <View style={styles.avatar}>
          {coverUrl && cover ? <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={cover.id} placeholder={cover.blurhash ? { blurhash: cover.blurhash } : undefined} /> : <CategoryIcon icon={vendor.category.icon} size={26} color={c.indigo} />}
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt variant="display" size="xxl" numberOfLines={2} accessibilityRole="header">
            {vendor.businessName}
          </Txt>
          <View style={styles.meta}>
            <Pill label={status.label} tone={status.tone} />
            <Txt size="sm">
              {vendor.rating.count ? `★ ${vendor.rating.avg.toFixed(1)} · ` : ''}
              {vendor.category.name}
            </Txt>
          </View>
        </View>
      </View>
      {!editable ? <Notice icon="lock" tone="warning">{t('profile.underReviewNote')}</Notice> : null}
      {tablet ? (
        <View style={styles.cols}>
          <View style={styles.col}>{left}</View>
          <View style={styles.col}>{right}</View>
        </View>
      ) : (
        <>
          {left}
          {right}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: space.xl },
  avatar: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: c.lilac, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  menuLabel: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  cols: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  col: { flex: 1, gap: space.lg },
});
