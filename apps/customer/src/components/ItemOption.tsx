import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rupees } from '@eventseva/app-shared';
import { haptic } from '../lib/haptics';
import type { Item } from '../lib/vendor';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { SelectedMark } from './Form';

/** "₹500 / plate", or just "₹45,000" for packages and fixed-price services. */
export function usePriceLabel() {
  const { t } = useTranslation();
  return (item: Pick<Item, 'pricePaise' | 'unit'>) =>
    item.unit === 'package' ? rupees(item.pricePaise) : `${rupees(item.pricePaise)} ${t(`units.${item.unit}`)}`;
}

/** Package / service card on the vendor page (selected: lilac fill, royal border, ✓). */
export const ItemOption = memo(function ItemOption({ item, selected, onPress }: { item: Item; selected: boolean; onPress: () => void }) {
  const price = usePriceLabel();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={`${item.title}, ${price(item)}`}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.box, selected && styles.on, pressed && styles.pressed]}
    >
      {selected ? <SelectedMark /> : <View style={styles.radio} />}
      <View style={styles.text}>
        <AppText variant="bold" size="md">
          {item.title}
        </AppText>
        {item.detail ? (
          <AppText size="xs" numberOfLines={3}>
            {item.detail}
          </AppText>
        ) : null}
      </View>
      <AppText variant="bold" size="md" color={c.royal}>
        {price(item)}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  box: {
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: c.outline,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.white,
  },
  on: { borderWidth: 2, borderColor: c.selectedBorder, backgroundColor: c.selectedBg },
  pressed: { opacity: 0.85 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.outline },
  text: { flex: 1, gap: 2 },
});
