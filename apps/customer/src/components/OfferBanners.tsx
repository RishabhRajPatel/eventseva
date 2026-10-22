// Home offer banners (Home board): a snapping horizontal carousel, one card per public offer.
// Tapping a card opens the Offers page.
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Offer } from '@eventseva/app-shared';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Pill } from './Bits';
import { useValidTill } from './Coupons';

const GAP = 12;

export function OfferBanners({ offers, width, gutter, isTablet }: { offers: Offer[]; width: number; gutter: number; isTablet: boolean }) {
  const { t } = useTranslation();
  const validTill = useValidTill();
  // With more than one offer the next card peeks in, so people see they can swipe.
  const single = offers.length === 1;
  const cardWidth = Math.max(240, Math.min(isTablet ? 480 : width, single ? width : width - 40));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + GAP}
      snapToAlignment="start"
      decelerationRate="fast"
      scrollEnabled={!single}
      style={{ marginHorizontal: -gutter }}
      contentContainerStyle={[styles.row, { paddingHorizontal: gutter }]}
    >
      {offers.map((o) => {
        const till = validTill(o);
        return (
          <Pressable
            key={o.code}
            accessibilityRole="button"
            accessibilityLabel={[t('offers.cardLabel', { title: o.title, summary: o.summary, code: o.code }), till].filter(Boolean).join('. ')}
            accessibilityHint={t('offers.view')}
            onPress={() => router.push('/offers')}
            style={({ pressed }) => [styles.banner, { width: cardWidth }, pressed && { opacity: 0.9 }]}
          >
            <Pill label={o.title} tone="peach" />
            <AppText variant="display" size={22} numberOfLines={2}>
              {o.summary}
            </AppText>
            <View style={styles.meta}>
              <View style={styles.code}>
                <AppText variant="bold" size="sm" color={c.royal}>
                  {o.code}
                </AppText>
              </View>
              {till ? (
                <AppText size="xs" style={styles.flex} numberOfLines={1}>
                  {till}
                </AppText>
              ) : null}
            </View>
            <View style={styles.action}>
              <AppText variant="bold" size="sm" color={c.white}>
                {t('offers.view')}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { gap: GAP },
  banner: { borderRadius: 18, backgroundColor: c.lilac, padding: 18, gap: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  code: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.royal,
    backgroundColor: c.white,
  },
  // Looks like the board's dark "View offer" button; the whole card is the touch target.
  action: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: 10, backgroundColor: c.ink },
});
