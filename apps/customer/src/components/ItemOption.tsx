import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rupees } from '@eventseva/app-shared';
import type { Item } from '../lib/vendor';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';

/** "₹500 / plate", or just "₹45,000" for packages and fixed-price services. */
export function usePriceLabel() {
  const { t } = useTranslation();
  return (item: Pick<Item, 'pricePaise' | 'unit'>) =>
    item.unit === 'package' ? rupees(item.pricePaise) : `${rupees(item.pricePaise)} ${t(`units.${item.unit}`)}`;
}

/** Package / service card on the vendor page (selected: royal border on lavender). */
export function ItemOption({ item, selected, onPress }: { item: Item; selected: boolean; onPress: () => void }) {
  const price = usePriceLabel();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.title}, ${price(item)}`}
      onPress={onPress}
      style={[styles.box, selected && styles.on]}
    >
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
      <AppText variant="bold" size={16} color={c.royal}>
        {price(item)}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: c.lilac,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.white,
  },
  on: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  text: { flex: 1, gap: 2 },
});

