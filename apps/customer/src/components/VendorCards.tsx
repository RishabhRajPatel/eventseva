import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rupees, type VendorCard as Vendor } from '@eventseva/app-shared';
import { prefetchVendor } from '../lib/queries';
import { c, radius, space } from '../lib/theme';
import { useShortlist } from '../hooks/useShortlist';
import { AppText } from './AppText';
import { Pill } from './Bits';
import { Icon } from './Icon';
import { VendorImage } from './VendorImage';

type CardVendor = Omit<Vendor, 'isFeatured' | 'startingPricePaise'> & Partial<Pick<Vendor, 'isFeatured' | 'startingPricePaise'>>;

/** Height ÷ width of the photo box: follows the cover photo, kept between 4:3 landscape and 3:4 portrait. */
export function cardAspect(v: Pick<Vendor, 'cover'>): number {
  if (!v.cover || !v.cover.width) return 1;
  return Math.min(4 / 3, Math.max(3 / 4, v.cover.height / v.cover.width));
}

const openVendor = (id: string) => router.push({ pathname: '/vendor/[id]', params: { id } });

function rating(v: CardVendor) {
  return v.ratingCount > 0 ? `★ ${v.ratingAvg.toFixed(1)}` : null;
}

/** Open the vendor page, with its data already loading from the moment the finger touches the card. */
function useOpenVendor(id: string) {
  const qc = useQueryClient();
  return {
    onPressIn: useCallback(() => prefetchVendor(qc, id), [qc, id]),
    onPress: useCallback(() => openVendor(id), [id]),
  };
}

/** Grid card (Search board): photo, name, rating · area, "From ₹…", heart. */
export const VendorCard = memo(function VendorCard({ vendor, width }: { vendor: CardVendor; width: number }) {
  const { t } = useTranslation();
  const shortlist = useShortlist();
  const open = useOpenVendor(vendor.id);
  const saved = shortlist.isSaved(vendor.id);
  const photoHeight = Math.round(width * cardAspect(vendor));
  const meta = [rating(vendor), vendor.area].filter(Boolean).join(' · ');
  const size = useMemo(() => ({ width }), [width]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={vendor.businessName}
      onPressIn={open.onPressIn}
      onPress={open.onPress}
      style={({ pressed }) => [styles.card, size, pressed && styles.pressed]}
    >
      <VendorImage media={vendor.cover} icon={vendor.category.icon} width={width} height={photoHeight} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? t('vendor.unsave') : t('vendor.save')}
        accessibilityState={{ selected: saved }}
        onPress={() => shortlist.toggle(vendor.id)}
        hitSlop={4}
        style={({ pressed }) => [styles.heart, pressed && styles.pressed]}
      >
        <View style={[styles.heartBg, saved && styles.heartOn]}>
          <Icon name="heart" size={18} color={c.royal} fill={saved ? c.royal : 'none'} />
        </View>
      </Pressable>
      <View style={styles.body}>
        <AppText variant="bold" size="md" numberOfLines={2}>
          {vendor.businessName}
        </AppText>
        {vendor.isFeatured ? <Pill label={t('vendor.featured')} tone="peach" /> : null}
        <AppText size="xs" numberOfLines={1}>
          {meta || vendor.category.name}
        </AppText>
        {vendor.startingPricePaise != null ? (
          <AppText variant="bold" size="sm" color={c.royal}>
            {t('vendor.from', { price: rupees(vendor.startingPricePaise) })}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

/** List row (Home board "Top vendors"): thumbnail, name, category · city · rating, Verified, price. */
export const VendorRow = memo(function VendorRow({ vendor, city }: { vendor: CardVendor; city: string }) {
  const { t } = useTranslation();
  const open = useOpenVendor(vendor.id);
  const meta = [vendor.category.name, vendor.area ?? city, rating(vendor)].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={vendor.businessName}
      onPressIn={open.onPressIn}
      onPress={open.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <VendorImage media={vendor.cover} icon={vendor.category.icon} width={64} height={64} style={styles.thumb} />
      <View style={styles.rowBody}>
        <AppText variant="bold" size="md" numberOfLines={1}>
          {vendor.businessName}
        </AppText>
        <AppText size="sm" numberOfLines={1}>
          {meta}
        </AppText>
        <Pill label={t('vendor.verified')} tone="mint" />
      </View>
      {vendor.startingPricePaise != null ? (
        <AppText variant="bold" size="sm" color={c.royal}>
          {rupees(vendor.startingPricePaise)}
        </AppText>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  card: { backgroundColor: c.white, borderRadius: radius.lg, overflow: 'hidden' },
  heart: { position: 'absolute', top: 0, right: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  heartBg: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  heartOn: { backgroundColor: c.selectedBg },
  body: { paddingHorizontal: space.md, paddingVertical: 10, gap: space.xs },
  row: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { borderRadius: radius.md },
  rowBody: { flex: 1, gap: space.xs },
});
