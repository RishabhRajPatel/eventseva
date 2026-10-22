import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native';
import type { ReactNode } from 'react';
import { c, radius, space, TOUCH } from '../lib/theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

export function Card({ children, style, onPress, testID, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

/** Card title row with an optional action on the right ("+ New", "Change"). */
export function CardHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.head}>
      <Txt variant="bold" size="md" style={{ flexShrink: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

/** A row inside a card, separated by a thin lavender line. */
export function Row({ children, onPress, first, style, testID, chevron }: { children: ReactNode; onPress?: () => void; first?: boolean; style?: StyleProp<ViewStyle>; testID?: string; chevron?: boolean }) {
  const content = (
    <>
      <View style={styles.rowInner}>{children}</View>
      {chevron ? <Icon name="next" size={16} color={c.muted} /> : null}
    </>
  );
  const rowStyle = [styles.row, first ? null : styles.rowBorder, style];
  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.7 : 1 }]}>
        {content}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={rowStyle}>
      {content}
    </View>
  );
}

export function Section({ title, right, children, style }: { title: string; right?: ReactNode; children: ReactNode; style?: ViewProps['style'] }) {
  return (
    <View style={[{ gap: space.md }, style]}>
      <View style={styles.sectionHead}>
        <Txt variant="display" size="xl">
          {title}
        </Txt>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 32 },
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowInner: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: c.lavender },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
