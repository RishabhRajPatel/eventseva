import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { categoryIcon, Icon } from './Icon';

const SHORT = ['dj', 'decor', 'catering', 'bartan', 'tent', 'planner', 'camera', 'hall', 'halwai', 'band', 'car', 'hotel', 'bartender', 'makeup', 'other'] as const;
type ShortSlug = (typeof SHORT)[number];
const hasShort = (slug: string): slug is ShortSlug => (SHORT as readonly string[]).includes(slug);

/** Short label for the grid ("Bartan" instead of "Bartan & Kitchen Equipment"); the API name for categories an admin added. */
export function useCategoryLabel() {
  const { t } = useTranslation();
  return (slug: string, apiName: string) => (hasShort(slug) ? t(`categoryShort.${slug}`) : apiName);
}

/** Lavender rounded square with the category icon and its name (Home board). */
export const CategoryTile = memo(function CategoryTile({ icon, label, onPress, size = 60, more }: { icon: string; label: string; onPress: () => void; size?: number; more?: boolean }) {
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={[styles.square, box, more && styles.more]}>
        <Icon name={more ? 'more' : categoryIcon(icon)} size={Math.round(size * 0.44)} color={c.royal} strokeWidth={1.8} />
      </View>
      <AppText size="xs" align="center" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: 6, minHeight: 48 },
  pressed: { opacity: 0.85 },
  square: { borderRadius: radius.lg, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  more: { backgroundColor: c.white, borderWidth: 1, borderColor: c.outline },
});
