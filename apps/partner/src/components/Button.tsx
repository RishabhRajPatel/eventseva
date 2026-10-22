import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { c, radius, space, TOUCH } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

type Kind = 'primary' | 'secondary' | 'outline' | 'indigo' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  size?: 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const KINDS: Record<Kind, { bg: string; fg: string; border?: string }> = {
  primary: { bg: c.royal, fg: c.white },
  indigo: { bg: c.indigo, fg: c.white },
  secondary: { bg: c.white, fg: c.royal, border: c.royal },
  outline: { bg: c.white, fg: c.ink, border: c.ink },
  danger: { bg: c.white, fg: c.danger, border: c.danger },
  ghost: { bg: 'transparent', fg: c.royal },
};

export function Button({ label, onPress, kind = 'primary', size = 'md', icon, loading, disabled, style, testID, accessibilityLabel }: ButtonProps) {
  const k = KINDS[kind];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { height: size === 'lg' ? 56 : TOUCH, backgroundColor: k.bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        k.border ? { borderWidth: 1.5, borderColor: k.border } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={k.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={18} color={k.fg} /> : null}
          <Txt variant="bold" size={size === 'lg' ? 'lg' : 'md'} color={k.fg} numberOfLines={1}>
            {label}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

/** A square icon button (back, bell, month arrows): 48dp touch target. */
export function IconButton({
  icon,
  onPress,
  label,
  bg = c.white,
  color = c.ink,
  badge,
  border,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  bg?: string;
  color?: string;
  badge?: number;
  border?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }, border ? { borderWidth: 1.5, borderColor: border } : null]}
    >
      <Icon name={icon} size={20} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <Txt variant="bold" size="xs" color={c.white}>
            {badge > 99 ? '99+' : badge}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A text link with a 48dp tall touch area. */
export function LinkButton({ label, onPress, color = c.royal, testID }: { label: string; onPress?: () => void; color?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={onPress} hitSlop={8} style={styles.link}>
      <Txt variant="bold" size="sm" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  icon: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { minHeight: TOUCH, justifyContent: 'center' },
});
