import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { c, radius, space, TOUCH } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'outline' | 'dark' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** lg = 56dp main actions (boards: 3.5rem), md = 48dp. */
  size?: 'lg' | 'md';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: c.royal, fg: c.white },
  secondary: { bg: c.lavender, fg: c.royal },
  outline: { bg: c.white, fg: c.royal, border: c.royal },
  dark: { bg: c.ink, fg: c.white },
  danger: { bg: c.white, fg: c.danger, border: c.danger },
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, loading, disabled, style, accessibilityHint }: ButtonProps) {
  const l = look[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: size === 'lg' ? 56 : TOUCH, backgroundColor: l.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        l.border ? { borderWidth: 1.5, borderColor: l.border } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={l.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} color={l.fg} size={20} /> : null}
          <AppText variant="bold" size={size === 'lg' ? 'lg' : 'md'} color={l.fg} numberOfLines={1}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

/** Square icon button (back, bell, heart, call): 48dp touch target. */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'white',
  badge,
  iconColor,
  filled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'white' | 'lavender' | 'outline';
  badge?: number;
  iconColor?: string;
  filled?: boolean;
}) {
  const bg = tone === 'lavender' ? c.lavender : c.white;
  const color = iconColor ?? (tone === 'white' ? c.ink : c.royal);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: bg, opacity: pressed ? 0.8 : 1 },
        tone === 'outline' ? { borderWidth: 1.5, borderColor: c.royal } : null,
      ]}
    >
      <Icon name={icon} color={color} fill={filled ? color : 'none'} />
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="bold" size={11} color={c.white}>
            {badge > 99 ? '99+' : String(badge)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconButton: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
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
});
