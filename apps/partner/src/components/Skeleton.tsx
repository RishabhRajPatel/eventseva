import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';

/** One pulsing grey block. */
export function Bone({ width = '100%', height = 14, style, round, square }: { width?: DimensionValue; height?: number; style?: StyleProp<ViewStyle>; round?: boolean; square?: boolean }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, borderRadius: round ? height / 2 : radius.sm, backgroundColor: c.lavender, opacity: pulse }, square ? { aspectRatio: 1 } : { height }, style]} />;
}

export type SkeletonKind = 'cards' | 'rows' | 'grid' | 'dashboard' | 'chat';

/** Placeholder shaped like the content that is loading (UX.md §5: skeletons, not spinners). */
export function Skeleton({ kind = 'cards', count = 3, columns = 4, padded, testID = 'loading' }: { kind?: SkeletonKind; count?: number; columns?: number; padded?: boolean; testID?: string }) {
  const { t } = useTranslation();
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <View testID={testID} style={[styles.wrap, padded ? styles.padded : null]} accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
      {kind === 'dashboard' ? (
        <>
          <View style={[styles.card, { backgroundColor: c.indigo, gap: space.lg }]}>
            <Bone width="30%" height={20} round />
            <Bone width="70%" height={26} />
            <View style={styles.row}>
              {[0, 1, 2].map((i) => (
                <Bone key={i} width="31%" height={64} />
              ))}
            </View>
          </View>
          <CardBones />
          <CardBones />
        </>
      ) : kind === 'grid' ? (
        <View style={styles.grid}>
          {Array.from({ length: Math.max(count, 8) }, (_, i) => (
            <View key={i} style={[styles.cell, { width: `${100 / columns}%` }]}>
              <Bone square />
            </View>
          ))}
        </View>
      ) : kind === 'rows' || kind === 'chat' ? (
        <View style={[styles.card, { gap: space.lg }]}>
          {items.map((i) => (
            <View key={i} style={styles.row}>
              {kind === 'chat' ? <Bone width={44} height={44} round /> : null}
              <View style={{ flex: 1, gap: space.sm }}>
                <Bone width="55%" height={16} />
                <Bone width="85%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        items.map((i) => <CardBones key={i} />)
      )}
    </View>
  );
}

function CardBones() {
  return (
    <View style={[styles.card, { gap: space.md }]}>
      <View style={styles.row}>
        <Bone width="60%" height={18} />
        <Bone width={72} height={22} round />
      </View>
      <View style={styles.row}>
        <Bone width="45%" height={12} />
        <Bone width="35%" height={12} />
      </View>
      <Bone width="80%" height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  padded: { padding: space.xl },
  card: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  cell: { padding: 3 },
});
