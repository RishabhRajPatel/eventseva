// Loading placeholders shaped like the content (UX.md §5: skeletons for lists and cards, spinners
// only inside buttons). All skeletons share one pulse animation on the native driver.
import { memo, useEffect, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';

const pulse = new Animated.Value(0.55);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;

function usePulse() {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
    }
    return () => {
      users -= 1;
      if (users === 0) {
        loop?.stop();
        loop = null;
      }
    };
  }, []);
  return pulse;
}

/** One grey-lavender block. */
export function Bone({ width = '100%', height = 14, round = radius.sm, style }: { width?: DimensionValue; height?: number; round?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.bone, { width, height, borderRadius: round }, style]} />;
}

/** Wraps skeleton content: pulses, and tells screen readers that content is loading. */
export function SkeletonGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const opacity = usePulse();
  return (
    <Animated.View
      testID="skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      accessibilityState={{ busy: true }}
      style={[{ opacity }, style]}
    >
      {children}
    </Animated.View>
  );
}

const repeat = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Search / Saved grid: photo, name, meta, price. */
export const VendorGridSkeleton = memo(function VendorGridSkeleton({ columns, width, rows = 2 }: { columns: number; width: number; rows?: number }) {
  const gap = space.lg;
  const cardWidth = Math.max(120, Math.floor((width - gap * (columns - 1)) / columns));
  return (
    <SkeletonGroup style={[styles.grid, { gap }]}>
      {repeat(columns * rows).map((i) => (
        <View key={i} style={[styles.card, { width: cardWidth }]}>
          <Bone width="100%" height={Math.round(cardWidth * (i % 2 ? 1.15 : 0.85))} round={0} />
          <View style={styles.cardBody}>
            <Bone width="80%" height={16} />
            <Bone width="55%" height={12} />
            <Bone width="45%" height={14} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Home "Top vendors" rows: thumbnail, two lines, a pill. */
export const VendorRowsSkeleton = memo(function VendorRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.stack}>
      {repeat(count).map((i) => (
        <View key={i} style={styles.row}>
          <Bone width={64} height={64} round={radius.md} />
          <View style={styles.rowText}>
            <Bone width="70%" height={16} />
            <Bone width="50%" height={12} />
            <Bone width={64} height={20} round={radius.pill} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Home category grid: rounded squares with a label. */
export const CategoryGridSkeleton = memo(function CategoryGridSkeleton({ perRow, size }: { perRow: number; size: number }) {
  return (
    <SkeletonGroup style={styles.catGrid}>
      {repeat(perRow).map((i) => (
        <View key={i} style={[styles.catCell, { width: `${100 / perRow}%` }]}>
          <Bone width={size} height={size} round={radius.lg} />
          <Bone width={size * 0.8} height={10} />
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Vendor page: hero photo, name, pills, packages, dates. */
export function VendorPageSkeleton({ heroHeight, gutter }: { heroHeight: number; gutter: number }) {
  return (
    <SkeletonGroup style={styles.page}>
      <Bone width="100%" height={heroHeight} round={0} />
      <View style={[styles.pageBody, { paddingHorizontal: gutter }]}>
        <View style={styles.pills}>
          <Bone width={72} height={22} round={radius.pill} />
          <Bone width={96} height={22} round={radius.pill} />
        </View>
        <Bone width="75%" height={28} />
        <Bone width="55%" height={14} />
        <Bone width="100%" height={60} />
        {repeat(3).map((i) => (
          <Bone key={i} width="100%" height={56} round={14} />
        ))}
        <View style={styles.pills}>
          {repeat(5).map((i) => (
            <Bone key={i} width={56} height={72} round={radius.md} />
          ))}
        </View>
      </View>
    </SkeletonGroup>
  );
}

/** My Events booking rows. */
export const BookingRowsSkeleton = memo(function BookingRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.stack}>
      {repeat(count).map((i) => (
        <View key={i} style={styles.row}>
          <Bone width={48} height={48} round={radius.md} />
          <View style={styles.rowText}>
            <Bone width="65%" height={16} />
            <Bone width="45%" height={12} />
          </View>
          <Bone width={72} height={22} round={radius.pill} />
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Chat list rows: round avatar, name and last message. */
export const ChatRowsSkeleton = memo(function ChatRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.stack}>
      {repeat(count).map((i) => (
        <View key={i} style={styles.row}>
          <Bone width={48} height={48} round={24} />
          <View style={styles.rowText}>
            <Bone width="55%" height={16} />
            <Bone width="80%" height={12} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Chat thread: alternating bubbles. */
export const MessagesSkeleton = memo(function MessagesSkeleton() {
  return (
    <SkeletonGroup style={styles.messages}>
      {[60, 45, 70, 35, 55].map((w, i) => (
        <Bone key={i} width={`${w}%`} height={40} round={16} style={i % 2 ? styles.right : null} />
      ))}
    </SkeletonGroup>
  );
});

/** Notifications: icon circle and three lines. */
export const NotificationsSkeleton = memo(function NotificationsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.stack}>
      {repeat(count).map((i) => (
        <View key={i} style={styles.rowTop}>
          <Bone width={40} height={40} round={20} />
          <View style={styles.rowText}>
            <Bone width="60%" height={16} />
            <Bone width="90%" height={12} />
            <Bone width="25%" height={10} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
});

/** Tall cards (offers, booking and payment pages). */
export const CardsSkeleton = memo(function CardsSkeleton({ count = 2, height = 160 }: { count?: number; height?: number }) {
  return (
    <SkeletonGroup style={styles.stack}>
      {repeat(count).map((i) => (
        <View key={i} style={[styles.bigCard, { height }]}>
          <Bone width={96} height={22} round={radius.pill} />
          <Bone width="80%" height={22} />
          <Bone width="100%" height={48} round={radius.md} />
        </View>
      ))}
    </SkeletonGroup>
  );
});

const styles = StyleSheet.create({
  bone: { backgroundColor: c.lavender },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { backgroundColor: c.white, borderRadius: radius.lg, overflow: 'hidden' },
  cardBody: { padding: space.md, gap: space.sm },
  stack: { gap: space.sm },
  row: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowTop: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowText: { flex: 1, gap: space.sm },
  catGrid: { flexDirection: 'row', rowGap: space.md },
  catCell: { alignItems: 'center', gap: 6 },
  page: { flex: 1, backgroundColor: c.white },
  pageBody: { paddingTop: space.xl, gap: space.md },
  pills: { flexDirection: 'row', gap: space.sm },
  messages: { flex: 1, padding: space.xl, gap: space.md, justifyContent: 'flex-end' },
  right: { alignSelf: 'flex-end' },
  bigCard: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.lg, gap: space.md },
});
