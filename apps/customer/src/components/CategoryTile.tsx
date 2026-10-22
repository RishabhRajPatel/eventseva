import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { categoryIcon, Icon } from './Icon';

const SHORT = ['hall', 'dj', 'camera', 'halwai', 'catering', 'band', 'car', 'decor', 'hotel', 'bartender', 'makeup', 'other'] as const;
type ShortSlug = (typeof SHORT)[number];
const hasShort = (slug: string): slug is ShortSlug => (SHORT as readonly string[]).includes(slug);

/** Short label for the grid ("Cook" instead of "Cook (halwai)"); the API name otherwise. */
export function useCategoryLabel() {
  const { t } = useTranslation();
  return (slug: string, apiName: string) => (hasShort(slug) ? t(`categoryShort.${slug}`) : apiName);
}

/** Lavender rounded square with the category icon and its name (Home board). */
export function CategoryTile({ slug, label, onPress, size = 60, more }: { slug: string; label: string; onPress: () => void; size?: number; more?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
      <View style={[styles.square, { width: size, height: size }, more && styles.more]}>
        <Icon name={more ? 'more' : categoryIcon(slug)} size={Math.round(size * 0.44)} color={c.royal} strokeWidth={1.8} />
      </View>
      <AppText size="xs" align="center" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: 6, minHeight: 48 },
  square: { borderRadius: radius.lg, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  more: { backgroundColor: c.white, borderWidth: 1, borderColor: c.lilac },
});
